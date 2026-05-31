import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_morador.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_conta.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewFinanceiroReceita extends StatefulWidget {
  final int? id;
  const NewFinanceiroReceita({Key? key, this.id}) : super(key: key);

  @override
  _NewFinanceiroReceitaPageState createState() => _NewFinanceiroReceitaPageState();
}

class _NewFinanceiroReceitaPageState extends State<NewFinanceiroReceita> {
  var _isLoading = false;
  var _isSaving = false;
  final txtTipo = TextEditingController();
  final txtCliente = TextEditingController();
  final txtRecebimento = TextEditingController();
  final txtValor = TextEditingController();
  final txtConta = TextEditingController();
  final txtDescricao = TextEditingController();

  @override
  void dispose() {
    txtTipo.dispose(); txtCliente.dispose(); txtRecebimento.dispose();
    txtValor.dispose(); txtConta.dispose(); txtDescricao.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.id != null && widget.id != -1) load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails('financeiro', widget.id!);
      txtTipo.text = obj['nome'] ?? '';
      txtCliente.text = obj['cliente'] ?? '';
      txtRecebimento.text = obj['data'] ?? '';
      txtValor.text = obj['valor'].toString();
      txtDescricao.text = obj['descricao'] ?? '';
      txtConta.text = obj['conta'] ?? '';
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      var obj = FinanceiroModel(
        id: widget.id, 
        id_condominio: Singleton.instance.id_condominio,
        nome: txtTipo.text, tipo: 'C', categoria: "Receita",
        data: txtRecebimento.text.isNotEmpty ? convertStringToDate(txtRecebimento.text) : null,
        data_vencimento: txtRecebimento.text.isNotEmpty ? convertStringToDate(txtRecebimento.text) : null,
        conta: txtConta.text, descricao: txtDescricao.text,
        valor: txtValor.text.isNotEmpty ? double.parse(txtValor.text.replaceAll('.', '').replaceAll(',', '.')) : 0.0,
        cliente: txtCliente.text,
      );
      var res = await apiSaveObject("financeiro", "financeiro", obj, widget.id != null && widget.id != -1);
      if (res.toString().isEmpty) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e, st) {
      // ignore: avoid_print
      print('[save receita] $e\n$st');
      if (mounted) displayMessage(
        context,
        getText('alert_error'),
        'Não foi possível salvar. Verifique os dados e tente novamente.',
      );
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> delete() async {
    var choice = await showConfirmDialog(context);
    if (choice != null && choice) {
      setState(() => _isSaving = true);
      var res = await apiDeleteObject('financeiro', widget.id!);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('financeiro_receita'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section(getText('financeiro_pagador').toUpperCase()),
                  AppInput(label: getText('financeiro_tipo'), controller: txtTipo, prefixIcon: PhosphorIcons.tag, textCapitalization: TextCapitalization.sentences),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('financeiro_forn_cliente'), controller: txtCliente, prefixIcon: PhosphorIcons.user, textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('data')),
                  AppInput(
                    label: getText('financeiro_data_recebimento'),
                    controller: txtRecebimento,
                    prefixIcon: PhosphorIcons.calendarBlank,
                    readOnly: true,
                    onTap: () => showCupertinoModalPopup(
                      context: context,
                      builder: (_) => ModalCupertino(
                        onPressed: (text) => setState(() => txtRecebimento.text = text),
                        initialDate: DateTime.now(),
                        minimumDate: DateTime.now().add(const Duration(days: -700)),
                        type: 'date',
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('financeiro_valores')),
                  AppInput(
                    label: getText('financeiro_valor'),
                    controller: txtValor,
                    prefixIcon: PhosphorIcons.currencyDollar,
                    keyboard: TextInputType.number,
                    formatters: [CurrencyTextInputFormatter.currency(decimalDigits: 2, symbol: '', locale: 'pt_BR')],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('financeiro_conta_bancaria'),
                    controller: txtConta,
                    prefixIcon: PhosphorIcons.bank,
                    readOnly: true,
                    onTap: () => bottomSheetConta(context, (s) {
                      txtConta.text = s;
                      Navigator.of(context).pop();
                      FocusManager.instance.primaryFocus?.unfocus();
                      setState(() {});
                    }),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('lb_descricao_opcional')),
                  AppInput(label: getText('lb_descricao'), controller: txtDescricao, prefixIcon: PhosphorIcons.notepad, maxLines: 3),
                  const SizedBox(height: AppSpacing.xl),
                  AppButton(
                    label: getText('btn_save'),
                    onPressed: _isSaving ? null : save,
                    loading: _isSaving,
                    icon: PhosphorIcons.floppyDisk,
                  ),
                  if (widget.id != -1) ...[
                    const SizedBox(height: AppSpacing.md),
                    AppButton(
                      label: getText('btn_delete'),
                      onPressed: _isSaving ? null : delete,
                      variant: AppButtonVariant.danger,
                      icon: PhosphorIcons.trash,
                    ),
                  ],
                  const SizedBox(height: AppSpacing.xxxl),
                ],
              ),
            ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(title.toUpperCase(),
            style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8)),
      );
}
