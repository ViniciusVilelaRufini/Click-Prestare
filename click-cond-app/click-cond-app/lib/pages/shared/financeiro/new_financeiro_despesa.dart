import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:click/pages/singleton.dart';

import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/financeiro/new_financeiro_morador.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_categoria_financeiro.dart';
import 'package:click/widgets/alerts/bottom_sheet_conta.dart';
import 'package:click/widgets/alerts/bottom_sheet_pagamento.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewFinanceiroDespesa extends StatefulWidget {
  final int? id;
  const NewFinanceiroDespesa({Key? key, this.id}) : super(key: key);

  @override
  _NewFinanceiroDespesaPageState createState() => _NewFinanceiroDespesaPageState();
}

class _NewFinanceiroDespesaPageState extends State<NewFinanceiroDespesa> {
  var _isLoading = false;
  var _isSaving = false;
  final txtFornecedor = TextEditingController();
  final txtCategoria = TextEditingController();
  final txtPagamento = TextEditingController();
  final txtValor = TextEditingController();
  final txtFormaPagamento = TextEditingController();
  final txtConta = TextEditingController();
  final txtDescricao = TextEditingController();
  final txtParcelas = TextEditingController();
  dynamic imageFile;
  var changed = false;

  @override
  void dispose() {
    txtFornecedor.dispose(); txtCategoria.dispose(); txtPagamento.dispose();
    txtValor.dispose(); txtFormaPagamento.dispose(); txtConta.dispose();
    txtDescricao.dispose(); txtParcelas.dispose();
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
      if (obj == null) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }
      txtFornecedor.text = obj['cliente'] ?? '';
      txtCategoria.text = obj['categoria'] ?? '';
      txtPagamento.text = obj['data'] ?? '';
      txtValor.text = (obj['valor'] ?? '').toString().replaceAll("-", "").replaceAll(" ", "");
      txtFormaPagamento.text = obj['forma_pagamento'] ?? '';
      txtParcelas.text = obj['parcelas'] != null ? obj['parcelas'].toString() : '';
      txtConta.text = obj['conta'] ?? '';
      txtDescricao.text = obj['descricao'] ?? '';
      // Best-effort: nunca deixa o comprovante quebrar o carregamento da tela.
      try {
        imageFile = await fileFromImageUrl(obj['photo'] ?? '');
      } catch (_) {
        imageFile = null;
      }
      if (mounted) setState(() {});
    } catch (e, st) {
      // ignore: avoid_print
      print('[load despesa] $e\n$st');
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      String? base64;
      if (imageFile != null && changed && !kIsWeb) {
        // ignore: undefined_class
        // List<int> imageBytes = [];
        // base64 = "data:image/png;base64," + base64Encode(imageBytes);
      }
      var obj = FinanceiroModel(
        id: widget.id, 
        id_condominio: Singleton.instance.id_condominio,
        tipo: 'D',
        nome: txtFornecedor.text, cliente: txtFornecedor.text,
        categoria: txtCategoria.text,
        data: txtPagamento.text.isNotEmpty ? convertStringToDate(txtPagamento.text) : null,
        data_vencimento: txtPagamento.text.isNotEmpty ? convertStringToDate(txtPagamento.text) : null,
        valor: txtValor.text.isNotEmpty ? double.parse(txtValor.text.replaceAll('.', '').replaceAll(',', '.')) : 0.0,
        forma_pagamento: txtFormaPagamento.text,
        parcelas: txtParcelas.text.isEmpty ? 1 : int.parse(txtParcelas.text),
        conta: txtConta.text, descricao: txtDescricao.text, photo: base64,
      );
      var res = await apiSaveObject("financeiro", "financeiro", obj, widget.id != null && widget.id != -1);
      if (res.toString().isEmpty) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e, st) {
      // Loga stack trace pra debug em release/web (dart2js as vezes converte
      // TypeError JS em mensagem indecifravel — sem o stack, vira caca preta).
      // ignore: avoid_print
      print('[save despesa] $e\n$st');
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

  Future<void> _selectPhoto() async {
    FocusManager.instance.primaryFocus?.unfocus();
    var res = await getPhoto(context);
    if (res != null) {
      imageFile = res;
      changed = true;
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('financeiro_despesa'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section(getText('financeiro_recebedor')),
                  AppInput(label: getText('financeiro_fornecedor'), controller: txtFornecedor, prefixIcon: PhosphorIcons.buildings, textCapitalization: TextCapitalization.sentences),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('financeiro_categoria'),
                    controller: txtCategoria,
                    prefixIcon: PhosphorIcons.tag,
                    readOnly: true,
                    onTap: () => bottomSheetCategoriaFinanceiro(context, (s) {
                      txtCategoria.text = s;
                      Navigator.of(context).pop();
                      FocusManager.instance.primaryFocus?.unfocus();
                      setState(() {});
                    }),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('data')),
                  AppInput(
                    label: getText('financeiro_dt_pag'),
                    controller: txtPagamento,
                    prefixIcon: PhosphorIcons.calendarBlank,
                    readOnly: true,
                    onTap: () => showCupertinoModalPopup(
                      context: context,
                      builder: (_) => ModalCupertino(
                        onPressed: (text) => setState(() => txtPagamento.text = text),
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
                  Row(
                    children: [
                      Expanded(
                        flex: 2,
                        child: AppInput(
                          label: getText('financeiro_forma_pagamento'),
                          controller: txtFormaPagamento,
                          prefixIcon: PhosphorIcons.creditCard,
                          readOnly: true,
                          onTap: () => bottomSheetPagamento(context, (s) {
                            txtFormaPagamento.text = s;
                            Navigator.of(context).pop();
                            FocusManager.instance.primaryFocus?.unfocus();
                            setState(() {});
                          }),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: getText('financeiro_parcelas'),
                          controller: txtParcelas,
                          keyboard: TextInputType.number,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('financeiro_conta_debito'),
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
                  _section(getText('financeiro_desc_comprovante')),
                  AppInput(label: getText('lb_descricao'), controller: txtDescricao, prefixIcon: PhosphorIcons.notepad, maxLines: 3),
                  const SizedBox(height: AppSpacing.md),
                  GestureDetector(
                    onTap: _selectPhoto,
                    child: Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.surface(context),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.border(context)),
                      ),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: imageFile == null
                                ? Container(
                                    width: 72, height: 72,
                                    color: AppColors.primary.withOpacity(0.08),
                                    child: Icon(PhosphorIcons.camera, color: AppColors.primary, size: 32),
                                  )
                                : (kIsWeb 
                                    ? Image.network(imageFile.path, width: 72, height: 72, fit: BoxFit.cover)
                                    : Image.network(imageFile.path, width: 72, height: 72, fit: BoxFit.cover)), // Simplificado para web/mobile test

                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Text(getText('financeiro_anexo_comprovante'),
                                style: AppTypography.body(context).copyWith(color: AppColors.textSecondary(context))),
                          ),
                        ],
                      ),
                    ),
                  ),
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
