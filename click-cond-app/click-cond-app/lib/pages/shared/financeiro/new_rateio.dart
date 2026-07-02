import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Rateio extraordinário: divide um valor total igualmente entre todos os
/// apartamentos do condomínio (o backend cria uma cobrança por apto, em
/// transação, e gera o Pix de cada uma).
class NewRateio extends StatefulWidget {
  const NewRateio({Key? key}) : super(key: key);

  @override
  NewRateioState createState() => NewRateioState();
}

class NewRateioState extends State<NewRateio> {
  bool _isSaving = false;
  final txtNome = TextEditingController();
  final txtValorTotal = TextEditingController();
  final txtVencimento = TextEditingController();
  final txtCategoria = TextEditingController(text: 'Rateio Extraordinário');

  @override
  void dispose() {
    txtNome.dispose(); txtValorTotal.dispose();
    txtVencimento.dispose(); txtCategoria.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final valor = txtValorTotal.text.isNotEmpty
        ? (double.tryParse(txtValorTotal.text.replaceAll('.', '').replaceAll(',', '.')) ?? 0.0)
        : 0.0;
    if (txtNome.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Informe a descrição do rateio (ex.: Reforma do telhado).');
      return;
    }
    if (valor <= 0) {
      displayMessage(context, getText('alert'), 'Informe o valor total do rateio (maior que zero).');
      return;
    }
    if (txtVencimento.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Informe a data de vencimento.');
      return;
    }

    final confirma = await showConfirmDialog(context);
    if (confirma != true) return;

    setState(() => _isSaving = true);
    final res = await apiCreateRateio({
      'nome': txtNome.text.trim(),
      'valorTotal': valor,
      'data_vencimento': txtVencimento.text,
      'categoria': txtCategoria.text.trim().isEmpty ? 'Rateio Extraordinário' : txtCategoria.text.trim(),
    });
    if (mounted) setState(() => _isSaving = false);
    if (!mounted) return;
    if (res['ok'] == true) {
      await displayMessage(context, getText('alert'),
          (res['message'] ?? '').toString().isNotEmpty
              ? res['message'].toString()
              : 'Rateio criado com sucesso!');
      if (mounted) Navigator.of(context).pop(true);
    } else {
      displayMessage(context, getText('alert_error'), res['message'].toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Rateio Extraordinário',
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'O valor total é dividido igualmente entre todos os apartamentos. '
              'Cada unidade recebe a própria cobrança com Pix.',
              style: AppTypography.caption(context),
            ),
            const SizedBox(height: AppSpacing.xl),
            _section('Dados do rateio'),
            AppInput(
              label: 'Descrição (ex.: Reforma do telhado)',
              controller: txtNome,
              prefixIcon: PhosphorIcons.notepad,
              textCapitalization: TextCapitalization.sentences,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: 'Valor total',
              controller: txtValorTotal,
              prefixIcon: PhosphorIcons.currencyDollar,
              keyboard: TextInputType.number,
              formatters: [CurrencyTextInputFormatter.currency(decimalDigits: 2, symbol: '', locale: 'pt_BR')],
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('financeiro_data_vencimento'),
              controller: txtVencimento,
              prefixIcon: PhosphorIcons.calendarX,
              readOnly: true,
              onTap: () => showCupertinoModalPopup(
                context: context,
                builder: (_) => ModalCupertino(
                  onPressed: (text) => setState(() => txtVencimento.text = text),
                  initialDate: DateTime.now(),
                  minimumDate: DateTime.now(),
                  type: 'date',
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: 'Categoria',
              controller: txtCategoria,
              prefixIcon: PhosphorIcons.tag,
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: 'Criar Rateio',
              onPressed: _isSaving ? null : _save,
              loading: _isSaving,
              icon: PhosphorIcons.usersThree,
            ),
            const SizedBox(height: AppSpacing.xxxl),
          ],
        ),
      ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(title.toUpperCase(),
            style: AppTypography.tiny(context).copyWith(
                color: AppColors.primary, letterSpacing: 0.8, fontWeight: FontWeight.bold)),
      );
}
