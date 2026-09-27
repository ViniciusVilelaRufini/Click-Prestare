import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';

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
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _buildUnitField(),
          const SizedBox(height: AppSpacing.lg),
          AppInput(
              label: 'Estabelecimento (opcional)',
              controller: _establishment,
              textCapitalization: TextCapitalization.words),
          const SizedBox(height: AppSpacing.md),
          AppInput(
              label: 'Nome do entregador (opcional)',
              controller: _delivererName,
              textCapitalization: TextCapitalization.words),
          const SizedBox(height: AppSpacing.md),
          AppInput(
              label: 'Telefone do entregador (opcional)',
              controller: _delivererPhone,
              keyboard: TextInputType.phone),
          const SizedBox(height: AppSpacing.md),
          _ForecastField(value: _forecast, onTap: _chooseForecast),
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<DeliveryModoEntrega>(
            initialValue: _mode,
            decoration: const InputDecoration(labelText: 'Tipo de entrega'),
            items: DeliveryModoEntrega.values
                .map((value) =>
                    DropdownMenuItem(value: value, child: Text(value.label)))
                .toList(),
            onChanged: (value) =>
                value == null ? null : setState(() => _mode = value),
          ),
          const SizedBox(height: AppSpacing.md),
          AppInput(
              label: 'Observação (opcional)',
              controller: _observation,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences),
          const SizedBox(height: AppSpacing.xxl),
          AppButton(
              label: 'Criar aviso',
              loading: _saving,
              onPressed: _saving ? null : _save),
        ]),
      ),
    );
  }

  Widget _buildUnitField() {
    if (_loadingUnits) {
      return const Row(children: [
        SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2)),
        SizedBox(width: AppSpacing.sm),
        Text('Carregando suas unidades...'),
      ]);
    }
    if (_unitsError != null) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_unitsError!, style: const TextStyle(color: AppColors.error)),
        const SizedBox(height: AppSpacing.sm),
        OutlinedButton(
            onPressed: _loadUnits,
            child: const Text('Tentar carregar novamente')),
      ]);
    }
    if (_units.length == 1) {
      return InputDecorator(
        key: const Key('delivery-unit-single'),
        decoration: const InputDecoration(labelText: 'Unidade do aviso'),
        child: Text(_units.single.label),
      );
    }
    return DropdownButtonFormField<int>(
      key: const Key('delivery-unit-selector'),
      initialValue: _selectedApartmentId,
      decoration: const InputDecoration(labelText: 'Unidade do aviso'),
      hint: const Text('Selecione a unidade'),
      items: _units
          .map((unit) =>
              DropdownMenuItem(value: unit.id, child: Text(unit.label)))
          .toList(),
      onChanged: (value) => setState(() => _selectedApartmentId = value),
    );
  }
}

class _ForecastField extends StatelessWidget {
  final DateTime? value;
  final VoidCallback onTap;
  const _ForecastField({required this.value, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final text = value == null
        ? 'Selecionar previsão (opcional)'
        : '${value!.day.toString().padLeft(2, '0')}/${value!.month.toString().padLeft(2, '0')}/${value!.year} ${value!.hour.toString().padLeft(2, '0')}:${value!.minute.toString().padLeft(2, '0')}';
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: const Icon(Icons.schedule, color: AppColors.primary),
      label: Align(alignment: Alignment.centerLeft, child: Text(text)),
      style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: AppSpacing.lg)),
    );
  }
}
