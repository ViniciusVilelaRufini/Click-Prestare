import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class DeliveryFormPage extends StatefulWidget {
  const DeliveryFormPage({super.key});

  @override
  State<DeliveryFormPage> createState() => _DeliveryFormPageState();
}

class _DeliveryFormPageState extends State<DeliveryFormPage> {
  final _establishment = TextEditingController();
  final _delivererName = TextEditingController();
  final _delivererPhone = TextEditingController();
  final _observation = TextEditingController();
  DateTime? _forecast;
  DeliveryModoEntrega _mode = DeliveryModoEntrega.unidade;
  List<DeliveryUnit> _units = const [];
  int? _selectedApartmentId;
  String? _unitsError;
  bool _loadingUnits = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
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

  Future<void> _chooseForecast() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _forecast ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(_forecast ?? DateTime.now()));
    if (time == null || !mounted) return;
    setState(() => _forecast =
        DateTime(date.year, date.month, date.day, time.hour, time.minute));
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
    final result = await apiCreateDelivery(
        DeliveryDraft(
          estabelecimento: _establishment.text,
          previsaoEm: _forecast?.toIso8601String(),
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
    return AppScaffold(
      title: 'Avisar entrega',
      bottomNavigationBar: _BottomBar(
        child: AppButton(
          label: 'Criar aviso',
          icon: PhosphorIcons.paperPlaneTilt,
          loading: _saving,
          onPressed: _saving ? null : _save,
        ),
      ),
      body: SingleChildScrollView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xxl),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
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
          _ForecastField(
            value: _forecast,
            onTap: _chooseForecast,
            onClear: () => setState(() => _forecast = null),
          ),
          const _SectionTitle('Entregador (opcional)'),
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
          const _SectionTitle('Observação'),
          AppInput(
              label: 'Observação (opcional)',
              hint: 'Ex.: interfone com defeito, ligar ao chegar',
              controller: _observation,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences),
        ]),
      ),
    );
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
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: AppSpacing.xl, bottom: AppSpacing.sm),
        child: Semantics(
          header: true,
          child: Text(
            text,
            style: AppTypography.captionMedium(context).copyWith(
              color: AppColors.textSecondary(context),
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
        ),
      );
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
    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      label: '$title. $subtitle',
      // excludeSemantics descarta o toque do InkWell: repete aqui.
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: selected
            ? AppColors.primary.withValues(alpha: 0.08)
            : AppColors.surface(context),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.rlg,
          side: BorderSide(
            color: selected ? AppColors.primary : AppColors.border(context),
            width: selected ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
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
                Icon(
                  selected ? PhosphorIcons.checkCircleFill : PhosphorIcons.circle,
                  size: 22,
                  color: selected ? AppColors.primary : AppColors.textTertiary(context),
                ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

/// Campo tocável da previsão de chegada, com ação de limpar.
class _ForecastField extends StatelessWidget {
  final DateTime? value;
  final VoidCallback onTap;
  final VoidCallback onClear;
  const _ForecastField(
      {required this.value, required this.onTap, required this.onClear});

  @override
  Widget build(BuildContext context) {
    final formatted = value == null
        ? null
        : DateFormat("dd/MM/yyyy 'às' HH:mm").format(value!);
    return Material(
      color: AppColors.surface(context),
      borderRadius: AppRadius.rlg,
      clipBehavior: Clip.antiAlias,
      child: Row(children: [
        Expanded(
          child: Semantics(
            button: true,
            label: formatted == null
                ? 'Previsão de chegada, opcional. Toque para escolher data e hora'
                : 'Previsão de chegada: $formatted. Toque para alterar',
            onTap: onTap,
            excludeSemantics: true,
            child: InkWell(
              key: const Key('delivery-forecast-field'),
              onTap: onTap,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 56),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg, vertical: AppSpacing.md),
                  child: Row(children: [
                    Icon(PhosphorIcons.calendarBlank,
                        size: 20,
                        color: formatted == null
                            ? AppColors.textSecondary(context)
                            : AppColors.primary),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Previsão de chegada (opcional)',
                                style: AppTypography.tiny(context).copyWith(
                                    color: AppColors.textSecondary(context))),
                            const SizedBox(height: 2),
                            Text(
                              formatted ?? 'Toque para escolher data e hora',
                              style: AppTypography.body(context).copyWith(
                                color: formatted == null
                                    ? AppColors.textTertiary(context)
                                    : AppColors.textPrimary(context),
                              ),
                            ),
                          ]),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        ),
        if (formatted != null)
          IconButton(
            tooltip: 'Limpar previsão',
            onPressed: onClear,
            icon: Icon(PhosphorIcons.x,
                size: 18, color: AppColors.textSecondary(context)),
          ),
      ]),
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
