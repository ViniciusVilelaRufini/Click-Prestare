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
  final _observation = TextEditingController();
  DateTime? _forecast;
  DeliveryModoEntrega _mode = DeliveryModoEntrega.unidade;
  bool _saving = false;

  @override
  void dispose() {
    _establishment.dispose();
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
    final time = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_forecast ?? DateTime.now()));
    if (time == null || !mounted) return;
    setState(() => _forecast = DateTime(date.year, date.month, date.day, time.hour, time.minute));
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final result = await apiCreateDelivery(DeliveryDraft(
      estabelecimento: _establishment.text,
      previsaoEm: _forecast?.toIso8601String(),
      observacaoMorador: _observation.text,
      modoEntrega: _mode,
    ));
    if (!mounted) return;
    setState(() => _saving = false);
    if (result.success) {
      Navigator.pop(context, true);
      return;
    }
    displayMessage(context, 'Erro', result.message ?? 'Não foi possível criar o aviso.');
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Avisar entrega',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('O aviso será criado para a sua unidade atual.', style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.lg),
          AppInput(label: 'Estabelecimento (opcional)', controller: _establishment, textCapitalization: TextCapitalization.words),
          const SizedBox(height: AppSpacing.md),
          _ForecastField(value: _forecast, onTap: _chooseForecast),
          const SizedBox(height: AppSpacing.md),
          DropdownButtonFormField<DeliveryModoEntrega>(
            initialValue: _mode,
            decoration: const InputDecoration(labelText: 'Tipo de entrega'),
            items: DeliveryModoEntrega.values.map((value) => DropdownMenuItem(value: value, child: Text(value.label))).toList(),
            onChanged: (value) => value == null ? null : setState(() => _mode = value),
          ),
          const SizedBox(height: AppSpacing.md),
          AppInput(label: 'Observação (opcional)', controller: _observation, maxLines: 4, textCapitalization: TextCapitalization.sentences),
          const SizedBox(height: AppSpacing.xxl),
          AppButton(label: 'Criar aviso', loading: _saving, onPressed: _saving ? null : _save),
        ]),
      ),
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
      style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.lg)),
    );
  }
}
