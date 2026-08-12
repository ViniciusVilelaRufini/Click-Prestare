import 'package:click/controllers/controller_vagas.dart';
import 'package:click/models/vaga_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class LiberarVagaPage extends StatefulWidget {
  const LiberarVagaPage({Key? key}) : super(key: key);

  @override
  State<LiberarVagaPage> createState() => _LiberarVagaPageState();
}

class _LiberarVagaPageState extends State<LiberarVagaPage> {
  String _tipo = 'visitante'; // 'visitante' | 'inquilino'
  bool _isLoading = true;
  bool _isSaving = false;

  List<BeneficiarioItem> _visitantes = [];
  List<BeneficiarioItem> _inquilinos = [];
  BeneficiarioItem? _selecionado;

  final _placaCtrl = TextEditingController();
  DateTime? _inicio;
  DateTime? _fim;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _placaCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _isLoading = true);
    try {
      final data = await apiGetBeneficiarios();
      final rawVisitantes = data['visitantes'] ?? <BeneficiarioItem>[];
      final seen = <String>{};
      final uniqueVisitantes = <BeneficiarioItem>[];
      for (final item in rawVisitantes) {
        final doc = (item.doc ?? '').trim();
        final nome = item.nome.trim().toLowerCase();
        final key = doc.isNotEmpty ? 'doc:$doc' : 'nome:$nome';
        if (seen.add(key)) {
          uniqueVisitantes.add(item);
        }
      }
      _visitantes = uniqueVisitantes;
      _inquilinos = data['inquilinos'] ?? [];
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List<BeneficiarioItem> get _lista =>
      _tipo == 'visitante' ? _visitantes : _inquilinos;

  /// Visitante selecionado sem foto → facial/portão não abre automaticamente.
  bool get _mostrarAvisoSemFoto =>
      _tipo == 'visitante' && _selecionado != null && !_selecionado!.temFoto;

  Future<void> _pickData({required bool inicio}) async {
    final base = inicio ? (_inicio ?? DateTime.now()) : (_fim ?? _inicio ?? DateTime.now());
    final d = await showDatePicker(
      context: context,
      initialDate: base,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d == null || !mounted) return;
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(base),
    );
    final dt = DateTime(d.year, d.month, d.day, t?.hour ?? 0, t?.minute ?? 0);
    setState(() {
      if (inicio) {
        _inicio = dt;
        if (_fim != null && _fim!.isBefore(dt)) _fim = null;
      } else {
        _fim = dt;
      }
    });
  }

  Future<void> _salvar() async {
    if (_selecionado == null) {
      displayMessage(context, 'Atenção', 'Selecione quem vai receber a vaga.');
      return;
    }
    if (_tipo == 'visitante' && (_inicio == null || _fim == null)) {
      displayMessage(context, 'Atenção', 'Informe o período de acesso (início e fim).');
      return;
    }
    if (_inicio != null && _fim != null && _fim!.isBefore(_inicio!)) {
      displayMessage(context, 'Atenção', 'O fim deve ser depois do início.');
      return;
    }

    setState(() => _isSaving = true);
    final erro = await apiLiberarVaga(
      tipo: _tipo,
      idVisitante: _tipo == 'visitante' ? _selecionado!.id : null,
      idMoradorBeneficiario: _tipo == 'inquilino' ? _selecionado!.id : null,
      placa: _placaCtrl.text.trim(),
      inicio: _inicio,
      fim: _fim,
    );
    if (!mounted) return;
    setState(() => _isSaving = false);
    if (erro.isEmpty) {
      Navigator.pop(context, true);
    } else {
      displayMessage(context, 'Erro', erro);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Liberar vaga',
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: [
                Text('Quem vai usar a vaga?',
                    style: AppTypography.bodyMedium(context)
                        .copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: AppSpacing.sm),
                _tipoSelector(context),
                const SizedBox(height: AppSpacing.lg),
                Text(
                    _tipo == 'visitante'
                        ? 'Visitante cadastrado'
                        : 'Inquilino / morador',
                    style: AppTypography.bodyMedium(context)
                        .copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: AppSpacing.sm),
                _beneficiarioList(context),
                if (_mostrarAvisoSemFoto) ...[
                  const SizedBox(height: AppSpacing.sm),
                  _avisoSemFoto(context),
                ],
                const SizedBox(height: AppSpacing.lg),
                Text('Placa do veículo (opcional)',
                    style: AppTypography.bodyMedium(context)
                        .copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: _placaCtrl,
                  textCapitalization: TextCapitalization.characters,
                  decoration: InputDecoration(
                    hintText: 'ABC1D23',
                    filled: true,
                    fillColor: AppColors.surface(context),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(color: AppColors.border(context)),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: BorderSide(color: AppColors.border(context)),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                    _tipo == 'visitante'
                        ? 'Período de acesso'
                        : 'Período (opcional)',
                    style: AppTypography.bodyMedium(context)
                        .copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                        child: _dateTile(context,
                            label: 'Início', value: _inicio, onTap: () => _pickData(inicio: true))),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                        child: _dateTile(context,
                            label: 'Fim', value: _fim, onTap: () => _pickData(inicio: false))),
                  ],
                ),
                const SizedBox(height: AppSpacing.xl),
                SizedBox(
                  height: 52,
                  child: ElevatedButton(
                    onPressed: _isSaving ? null : _salvar,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    child: _isSaving
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : Text('Liberar vaga',
                            style: AppTypography.button(context)
                                .copyWith(color: Colors.white)),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _tipoSelector(BuildContext context) {
    Widget opt(String value, String label, IconData icon) {
      final active = _tipo == value;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() {
            _tipo = value;
            _selecionado = null;
          }),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              color: active
                  ? AppColors.primary.withOpacity(0.12)
                  : AppColors.surface(context),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: active ? AppColors.primary : AppColors.border(context),
                width: active ? 1.5 : 1,
              ),
            ),
            child: Column(
              children: [
                Icon(icon,
                    color: active ? AppColors.primary : AppColors.textTertiary(context)),
                const SizedBox(height: 4),
                Text(label,
                    style: AppTypography.caption(context).copyWith(
                        color: active ? AppColors.primary : null,
                        fontWeight: active ? FontWeight.bold : FontWeight.normal)),
              ],
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        opt('visitante', 'Visitante', PhosphorIcons.userCircle),
        const SizedBox(width: AppSpacing.sm),
        opt('inquilino', 'Inquilino', PhosphorIcons.house),
      ],
    );
  }

  Widget _beneficiarioList(BuildContext context) {
    if (_lista.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Text(
          _tipo == 'visitante'
              ? 'Nenhum visitante cadastrado no apartamento.'
              : 'Nenhum inquilino cadastrado no apartamento.',
          style: AppTypography.caption(context),
        ),
      );
    }
    return Column(
      children: _lista.map((b) {
        final active = _selecionado?.id == b.id;
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: GestureDetector(
            onTap: () => setState(() => _selecionado = b),
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: active
                    ? AppColors.primary.withOpacity(0.08)
                    : AppColors.surface(context),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: active ? AppColors.primary : AppColors.border(context),
                  width: active ? 1.5 : 1,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    active ? PhosphorIcons.checkCircleFill : PhosphorIcons.circle,
                    color: active ? AppColors.primary : AppColors.textTertiary(context),
                    size: 22,
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(b.nome,
                            style: AppTypography.bodyMedium(context)
                                .copyWith(fontWeight: FontWeight.w600)),
                        if (b.doc != null && b.doc!.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(b.doc!, style: AppTypography.caption(context)),
                        ],
                        if (_tipo == 'visitante' && !b.temFoto) ...[
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Icon(PhosphorIcons.warningCircle,
                                  size: 14, color: AppColors.warning),
                              const SizedBox(width: 4),
                              Expanded(
                                child: Text('Sem foto — facial não abre',
                                    style: AppTypography.tiny(context)
                                        .copyWith(color: AppColors.warning)),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _avisoSemFoto(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.warning.withOpacity(0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.warning.withOpacity(0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(PhosphorIcons.warningCircleFill,
              size: 20, color: AppColors.warning),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Esse visitante não tem foto',
                    style: AppTypography.caption(context).copyWith(
                        fontWeight: FontWeight.bold, color: AppColors.warning)),
                const SizedBox(height: 2),
                Text(
                  'Sem foto, o portão/facial não abre sozinho. Ele poderá entrar '
                  'pelo código de acesso (PIN). Para liberar no facial, cadastre '
                  'uma foto do visitante.',
                  style: AppTypography.caption(context),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _dateTile(BuildContext context,
      {required String label, required DateTime? value, required VoidCallback onTap}) {
    String fmt(DateTime d) =>
        '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.surface(context),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: AppTypography.tiny(context)),
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(PhosphorIcons.calendarBlank,
                    size: 16, color: AppColors.textTertiary(context)),
                const SizedBox(width: 6),
                Text(value == null ? 'Selecionar' : fmt(value),
                    style: AppTypography.caption(context)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
