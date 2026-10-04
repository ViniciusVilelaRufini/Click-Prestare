import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_status_style.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Atalhos de "Quando chega?".
enum DeliveryForecastPreset { sem, agora, em30, noite, escolher }

/// Previsão de chegada para o atalho escolhido (sem segundos); null quando
/// não há previsão. "Hoje à noite" é 19:00, ou daqui a 2 h se já passou.
DateTime? forecastForPreset(DeliveryForecastPreset preset, DateTime now,
    {DateTime? custom}) {
  final minuto = DateTime(now.year, now.month, now.day, now.hour, now.minute);
  switch (preset) {
    case DeliveryForecastPreset.sem:
      return null;
    case DeliveryForecastPreset.agora:
      return minuto;
    case DeliveryForecastPreset.em30:
      return minuto.add(const Duration(minutes: 30));
    case DeliveryForecastPreset.noite:
      final noite = DateTime(now.year, now.month, now.day, 19);
      return now.isBefore(noite) ? noite : minuto.add(const Duration(hours: 2));
    case DeliveryForecastPreset.escolher:
      return custom;
  }
}

/// Estabelecimentos mais comuns, para tocar em vez de digitar.
const _atalhosEstabelecimento = [
  'iFood',
  'Rappi',
  'Mercado Livre',
  'Farmácia',
  'Mercado',
];

class DeliveryFormPage extends StatefulWidget {
  /// Estabelecimento já preenchido (p.ex. "Avisar nova entrega" a partir de
  /// um aviso encerrado).
  final String? prefillEstablishment;

  const DeliveryFormPage({super.key, this.prefillEstablishment});

  @override
  State<DeliveryFormPage> createState() => _DeliveryFormPageState();
}

class _DeliveryFormPageState extends State<DeliveryFormPage> {
  final _establishment = TextEditingController();
  final _delivererName = TextEditingController();
  final _delivererPhone = TextEditingController();
  final _observation = TextEditingController();
  DeliveryForecastPreset _preset = DeliveryForecastPreset.sem;
  DateTime? _customForecast;
  DeliveryModoEntrega _mode = DeliveryModoEntrega.unidade;
  List<DeliveryUnit> _units = const [];
  int? _selectedApartmentId;
  String? _unitsError;
  bool _loadingUnits = true;
  bool _saving = false;
  bool _detailsExpanded = false;

  @override
  void initState() {
    super.initState();
    _establishment.text = widget.prefillEstablishment?.trim() ?? '';
    // Abre "Mais detalhes" se algo dali já estiver preenchido.
    _detailsExpanded = _hasDetails;
    _loadUnits();
  }

  @override
  void dispose() {
    _establishment.dispose();
    _delivererName.dispose();
    _delivererPhone.dispose();
    _observation.dispose();
    super.dispose();
  }

  bool get _hasDetails =>
      _delivererName.text.trim().isNotEmpty ||
      _delivererPhone.text.trim().isNotEmpty ||
      _observation.text.trim().isNotEmpty;

  Future<void> _chooseForecast() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _customForecast ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(_customForecast ?? DateTime.now()));
    if (time == null || !mounted) return;
    setState(() {
      _customForecast =
          DateTime(date.year, date.month, date.day, time.hour, time.minute);
      _preset = DeliveryForecastPreset.escolher;
    });
  }

  void _selectPreset(DeliveryForecastPreset preset) {
    HapticFeedback.selectionClick();
    if (preset == DeliveryForecastPreset.escolher) {
      // Cancelar os seletores mantém a escolha anterior.
      _chooseForecast();
      return;
    }
    setState(() => _preset = preset);
  }

  Future<void> _loadUnits() async {
    if (mounted) setState(() => _loadingUnits = true);
    final result = await apiGetDeliveryUnits();
    if (!mounted) return;
    setState(() {
      _loadingUnits = false;
      _units = result.units;
      _selectedApartmentId =
          result.units.length == 1 ? result.units.single.id : null;
      _unitsError = result.message ??
          (result.units.isEmpty
              ? 'Nenhuma unidade vinculada foi encontrada.'
              : null);
    });
  }

  Future<void> _save() async {
    if (_selectedApartmentId == null) {
      displayMessage(context, 'Atenção', 'Selecione a unidade do aviso.');
      return;
    }
    setState(() => _saving = true);
    final forecast = forecastForPreset(_preset, DateTime.now(),
        custom: _customForecast);
    final result = await apiCreateDelivery(
        DeliveryDraft(
          estabelecimento: _establishment.text,
          previsaoEm: forecast?.toIso8601String(),
          observacaoMorador: _observation.text,
          nomeEntregador: _delivererName.text,
          telefoneEntregador: _delivererPhone.text,
          modoEntrega: _mode,
        ),
        idApartamento: _selectedApartmentId);
    if (!mounted) return;
    setState(() => _saving = false);
    if (result.success) {
      Navigator.pop(context, true);
      return;
    }
    displayMessage(
        context, 'Erro', result.message ?? 'Não foi possível criar o aviso.');
  }

  @override
  Widget build(BuildContext context) {
    // A barra fica no corpo (e não em bottomNavigationBar): o Scaffold
    // encolhe o corpo quando o teclado abre, então "Criar aviso" sobe junto
    // e o campo focado rola para a área visível acima dela.
    return AppScaffold(
      title: 'Avisar entrega',
      safeAreaBottom: false,
      body: Column(children: [
        Expanded(child: _buildForm(context)),
        _BottomBar(
          child: AppButton(
            label: 'Criar aviso',
            icon: PhosphorIcons.paperPlaneTilt,
            loading: _saving,
            onPressed: _saving ? null : _save,
          ),
        ),
      ]),
    );
  }

  Widget _buildForm(BuildContext context) {
    return SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xxl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(
          'Avise a portaria para agilizar a liberação da sua entrega.',
          style: AppTypography.caption(context),
        ),
        const _SectionTitle('Unidade'),
        _buildUnitField(),
        const _SectionTitle('Sobre a entrega'),
        AppInput(
            label: 'Estabelecimento (opcional)',
            hint: 'Ex.: iFood, farmácia, mercado',
            prefixIcon: PhosphorIcons.storefront,
            controller: _establishment,
            textCapitalization: TextCapitalization.words),
        const SizedBox(height: AppSpacing.md),
        _buildEstablishmentShortcuts(),
        const _SectionTitle('Quando chega?'),
        _buildForecastPresets(),
        const _SectionTitle('Como receber'),
        _ModeCard(
          key: const Key('delivery-mode-unidade'),
          icon: PhosphorIcons.house,
          title: 'Na unidade',
          subtitle: 'O entregador sobe até o seu apartamento',
          selected: _mode == DeliveryModoEntrega.unidade,
          onTap: () => setState(() => _mode = DeliveryModoEntrega.unidade),
        ),
        const SizedBox(height: AppSpacing.sm),
        _ModeCard(
          key: const Key('delivery-mode-portaria'),
          icon: PhosphorIcons.storefront,
          title: 'Na portaria',
          subtitle: 'Você retira na portaria',
          selected: _mode == DeliveryModoEntrega.portaria,
          onTap: () => setState(() => _mode = DeliveryModoEntrega.portaria),
        ),
        const SizedBox(height: AppSpacing.sm),
        _Hint(
          icon: PhosphorIcons.info,
          text: _mode == DeliveryModoEntrega.unidade
              ? 'Quando o entregador chegar, a portaria pode pedir sua autorização pelo app.'
              : 'Você acompanha por aqui quando a entrega estiver na portaria.',
        ),
        const SizedBox(height: AppSpacing.xl),
        _buildMoreDetails(),
      ]),
    );
  }

  Widget _buildEstablishmentShortcuts() {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: _establishment,
      builder: (context, value, _) {
        final atual = value.text.trim().toLowerCase();
        return Wrap(spacing: AppSpacing.sm, runSpacing: 0, children: [
          for (final atalho in _atalhosEstabelecimento)
            _PickChip(
              label: atalho,
              selected: atual == atalho.toLowerCase(),
              onSelected: () {
                HapticFeedback.selectionClick();
                // Tocar de novo no atalho escolhido limpa o campo.
                final novo = atual == atalho.toLowerCase() ? '' : atalho;
                _establishment.value = TextEditingValue(
                  text: novo,
                  selection: TextSelection.collapsed(offset: novo.length),
                );
              },
            ),
        ]);
      },
    );
  }

  Widget _buildForecastPresets() {
    final forecast =
        forecastForPreset(_preset, DateTime.now(), custom: _customForecast);
    final custom = _customForecast;
    final chips = <(DeliveryForecastPreset, String, IconData)>[
      (DeliveryForecastPreset.sem, 'Sem previsão', PhosphorIcons.calendarX),
      (DeliveryForecastPreset.agora, 'Agora', PhosphorIcons.lightning),
      (DeliveryForecastPreset.em30, 'Em 30 min', PhosphorIcons.clock),
      (DeliveryForecastPreset.noite, 'Hoje à noite', PhosphorIcons.moon),
      (
        DeliveryForecastPreset.escolher,
        _preset == DeliveryForecastPreset.escolher && custom != null
            ? DateFormat("dd/MM 'às' HH:mm").format(custom)
            : 'Escolher horário',
        PhosphorIcons.calendarBlank,
      ),
    ];
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(spacing: AppSpacing.sm, runSpacing: 0, children: [
        for (final (preset, label, icon) in chips)
          _PickChip(
            label: label,
            icon: icon,
            selected: _preset == preset,
            onSelected: () => _selectPreset(preset),
          ),
      ]),
      const SizedBox(height: AppSpacing.xs),
      _Hint(
        icon: forecast == null ? PhosphorIcons.info : PhosphorIcons.clock,
        text: forecast == null
            ? 'Sem horário previsto: a portaria fica avisada mesmo assim.'
            : 'Previsão: ${relativeTime(forecast.toIso8601String())} '
                '(${DateFormat("dd/MM 'às' HH:mm").format(forecast)})',
      ),
    ]);
  }

  Widget _buildMoreDetails() {
    final resumo = [
      if (_delivererName.text.trim().isNotEmpty) _delivererName.text.trim(),
      if (_delivererPhone.text.trim().isNotEmpty) _delivererPhone.text.trim(),
      if (_observation.text.trim().isNotEmpty) 'com observação',
    ].join(' · ');
    final reduce = MediaQuery.of(context).disableAnimations;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Semantics(
        button: true,
        expanded: _detailsExpanded,
        label: 'Mais detalhes (opcional). ${resumo.isEmpty ? 'Entregador e observação' : resumo}',
        onTap: () => setState(() => _detailsExpanded = !_detailsExpanded),
        excludeSemantics: true,
        child: Material(
          color: AppColors.surface(context),
          borderRadius: AppRadius.rlg,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => setState(() => _detailsExpanded = !_detailsExpanded),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 64),
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Row(children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.10),
                      borderRadius: AppRadius.rmd,
                    ),
                    child: const Icon(PhosphorIcons.listPlus,
                        size: 20, color: AppColors.primary),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Mais detalhes (opcional)',
                              style: AppTypography.bodyMedium(context)
                                  .copyWith(fontWeight: FontWeight.w600)),
                          Text(
                            !_detailsExpanded && resumo.isNotEmpty
                                ? resumo
                                : 'Entregador e observação',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTypography.caption(context)
                                .copyWith(fontSize: 13),
                          ),
                        ]),
                  ),
                  AnimatedRotation(
                    turns: _detailsExpanded ? 0.5 : 0,
                    duration: reduce
                        ? Duration.zero
                        : const Duration(milliseconds: 200),
                    child: Icon(PhosphorIcons.caretDown,
                        size: 18, color: AppColors.textSecondary(context)),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ),
      AnimatedSize(
        duration: reduce ? Duration.zero : const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
        alignment: Alignment.topCenter,
        child: !_detailsExpanded
            ? const SizedBox(width: double.infinity)
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _SectionTitle('Entregador', small: true),
                  AppInput(
                      label: 'Nome do entregador (opcional)',
                      prefixIcon: PhosphorIcons.user,
                      controller: _delivererName,
                      textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                      label: 'Telefone do entregador (opcional)',
                      prefixIcon: PhosphorIcons.phone,
                      controller: _delivererPhone,
                      keyboard: TextInputType.phone),
                  const _SectionTitle('Observação', small: true),
                  AppInput(
                      label: 'Observação (opcional)',
                      hint: 'Ex.: interfone com defeito, ligar ao chegar',
                      controller: _observation,
                      maxLines: 4,
                      textCapitalization: TextCapitalization.sentences),
                ],
              ),
      ),
    ]);
  }

  Widget _buildUnitField() {
    if (_loadingUnits) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
            color: AppColors.surface(context), borderRadius: AppRadius.rlg),
        child: Row(children: [
          const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text('Carregando suas unidades...',
                style: AppTypography.caption(context)),
          ),
        ]),
      );
    }
    if (_unitsError != null) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.error.withValues(alpha: 0.08),
          borderRadius: AppRadius.rlg,
          border: Border.all(color: AppColors.error.withValues(alpha: 0.25)),
        ),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Icon(PhosphorIcons.warningCircle,
                size: 20, color: AppColors.error),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(_unitsError!,
                  style: AppTypography.caption(context)
                      .copyWith(color: AppColors.error)),
            ),
          ]),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44)),
              onPressed: _loadUnits,
              child: const Text('Tentar carregar novamente')),
        ]),
      );
    }
    if (_units.length == 1) {
      return InputDecorator(
        key: const Key('delivery-unit-single'),
        decoration: _fieldDecoration(context, 'Unidade do aviso'),
        child: Text(_units.single.label, style: AppTypography.body(context)),
      );
    }
    return DropdownButtonFormField<int>(
      key: const Key('delivery-unit-selector'),
      initialValue: _selectedApartmentId,
      decoration: _fieldDecoration(context, 'Unidade do aviso'),
      hint: const Text('Selecione a unidade'),
      dropdownColor: AppColors.surfaceElevated(context),
      borderRadius: AppRadius.rlg,
      items: _units
          .map((unit) =>
              DropdownMenuItem(value: unit.id, child: Text(unit.label)))
          .toList(),
      onChanged: (value) => setState(() => _selectedApartmentId = value),
    );
  }
}

/// Mesmo visual do AppInput para os campos que não são texto livre.
InputDecoration _fieldDecoration(BuildContext context, String label) {
  final noBorder =
      OutlineInputBorder(borderRadius: AppRadius.rlg, borderSide: BorderSide.none);
  return InputDecoration(
    labelText: label,
    prefixIcon: Icon(PhosphorIcons.buildings,
        size: 20, color: AppColors.textSecondary(context)),
    filled: true,
    fillColor: AppColors.surface(context),
    contentPadding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg, vertical: AppSpacing.lg),
    labelStyle: AppTypography.body(context)
        .copyWith(color: AppColors.textSecondary(context)),
    floatingLabelStyle:
        AppTypography.captionMedium(context).copyWith(color: AppColors.primary),
    border: noBorder,
    enabledBorder: noBorder,
    focusedBorder: OutlineInputBorder(
      borderRadius: AppRadius.rlg,
      borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
    ),
  );
}

class _SectionTitle extends StatelessWidget {
  final String text;
  final bool small;
  const _SectionTitle(this.text, {this.small = false});

  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.only(
            top: small ? AppSpacing.lg : AppSpacing.xxl, bottom: AppSpacing.sm),
        child: Semantics(
          header: true,
          child: Text(
            text,
            style: (small
                    ? AppTypography.tiny(context)
                    : AppTypography.captionMedium(context))
                .copyWith(
              color: AppColors.textSecondary(context),
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
        ),
      );
}

/// Linha de ajuda discreta (ícone + texto).
class _Hint extends StatelessWidget {
  final IconData icon;
  final String text;
  const _Hint({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icon, size: 14, color: AppColors.textTertiary(context)),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(text,
                style: AppTypography.caption(context).copyWith(fontSize: 12.5)),
          ),
        ],
      );
}

/// Chip de escolha rápida no padrão do app (alvo de toque de 48 dp).
class _PickChip extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool selected;
  final VoidCallback onSelected;
  const _PickChip({
    required this.label,
    required this.selected,
    required this.onSelected,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final fg = selected ? AppColors.primary : AppColors.textPrimary(context);
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onSelected(),
      showCheckmark: false,
      avatar: icon == null ? null : Icon(icon, size: 16, color: fg),
      selectedColor: AppColors.primary.withValues(alpha: 0.14),
      backgroundColor: AppColors.surface(context),
      side: BorderSide(
        color: selected ? AppColors.primary : AppColors.border(context),
        width: selected ? 1.4 : 1,
      ),
      shape: const StadiumBorder(),
      labelStyle: AppTypography.captionMedium(context).copyWith(
        color: fg,
        fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
      ),
    );
  }
}

/// Card selecionável do modo de entrega (escolha única).
class _ModeCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;

  const _ModeCard({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final accent = selected ? AppColors.primary : AppColors.textSecondary(context);
    final reduce = MediaQuery.of(context).disableAnimations;
    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      label: '$title. $subtitle',
      // excludeSemantics descarta o toque do InkWell: repete aqui.
      onTap: onTap,
      excludeSemantics: true,
      child: AnimatedContainer(
        duration: reduce ? Duration.zero : const Duration(milliseconds: 180),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.primary.withValues(alpha: 0.08)
              : AppColors.surface(context),
          borderRadius: AppRadius.rlg,
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.border(context),
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: AppRadius.rlg,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () {
              HapticFeedback.selectionClick();
              onTap();
            },
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 64),
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Row(children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: selected
                          ? AppColors.primary.withValues(alpha: 0.14)
                          : AppColors.surfaceElevated(context),
                      borderRadius: AppRadius.rmd,
                    ),
                    child: Icon(icon, size: 20, color: accent),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(title,
                              style: AppTypography.bodyMedium(context)
                                  .copyWith(fontWeight: FontWeight.w600)),
                          Text(subtitle,
                              style: AppTypography.caption(context)
                                  .copyWith(fontSize: 13)),
                        ]),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  AnimatedSwitcher(
                    duration: reduce
                        ? Duration.zero
                        : const Duration(milliseconds: 180),
                    transitionBuilder: (child, animation) =>
                        ScaleTransition(scale: animation, child: child),
                    child: Icon(
                      selected
                          ? PhosphorIcons.checkCircleFill
                          : PhosphorIcons.circle,
                      key: ValueKey(selected),
                      size: 22,
                      color: selected
                          ? AppColors.primary
                          : AppColors.textTertiary(context),
                    ),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  final Widget child;
  const _BottomBar({required this.child});

  @override
  Widget build(BuildContext context) => Container(
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated(context),
          border: Border(top: BorderSide(color: AppColors.border(context))),
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
            child: child,
          ),
        ),
      );
}
