import 'dart:convert';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_conta.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:currency_text_input_formatter/currency_text_input_formatter.dart';
import 'package:easy_mask/easy_mask.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:file_picker/file_picker.dart';
import 'package:click/pages/singleton.dart';

class NewFinanceiroMorador extends StatefulWidget {
  const NewFinanceiroMorador({Key? key, required this.apto, this.id}) : super(key: key);
  final dynamic apto;
  final int? id;

  @override
  _NewFinanceiroMoradorPageState createState() => _NewFinanceiroMoradorPageState();
}

class _NewFinanceiroMoradorPageState extends State<NewFinanceiroMorador> {
  var id = -1;
  var _isLoading = false;
  var _isSaving = false;
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();
  final txtReferencia = TextEditingController();
  final txtVencimento = TextEditingController();
  final txtPagamento = TextEditingController();
  final txtValor = TextEditingController();
  final txtConta = TextEditingController();
  final txtDescricao = TextEditingController();
  final txtLinhaDigitavel = TextEditingController();
  final txtPixCopiaCola = TextEditingController();

  String _selectedCategoria = 'Condomínio';
  String? _urlBoleto;
  var list = [];
  var listBlocos = [];

  @override
  void dispose() {
    txtBloco.dispose(); txtApto.dispose(); txtReferencia.dispose();
    txtVencimento.dispose(); txtPagamento.dispose();
    txtValor.dispose(); txtConta.dispose(); txtDescricao.dispose();
    txtLinhaDigitavel.dispose(); txtPixCopiaCola.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.apto != null) {
      var pago = widget.apto["pago"] ?? 1;
      id = widget.apto["financeiro_id"] ?? -1;
      txtBloco.text = widget.apto['bloco'] ?? '';
      txtApto.text = widget.apto['apto'] ?? '';
      txtReferencia.text = "${widget.apto['mes']}/${widget.apto['ano']}";
      txtVencimento.text = widget.apto['data_vencimento'] ?? '';
      txtPagamento.text = pago == 1 ? widget.apto['data'] ?? '' : '';
      txtValor.text = widget.apto['valor'].toString();
      txtDescricao.text = widget.apto['descricao'] ?? '';
      txtConta.text = widget.apto['conta'] ?? '';
      txtLinhaDigitavel.text = widget.apto['linha_digitavel'] ?? '';
      txtPixCopiaCola.text = widget.apto['pix_copia_cola'] ?? '';
      _selectedCategoria = widget.apto['categoria'] ?? 'Condomínio';
      _urlBoleto = widget.apto['url_boleto'];
    } else if (widget.id != null) {
      load();
    }
    loadListAptos();
  }

  Future<void> loadListAptos() async {
    try {
      setState(() => _isLoading = true);
      var aptos = await apiGetAll("apartamentos");
      list = aptos;
      listBlocos.clear();
      for (var item in list) {
        if (!listBlocos.contains(item['bloco'])) listBlocos.add(item['bloco']);
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  List getListAptos() {
    var listAptos = [];
    for (var item in list) {
      if (item['bloco'] == txtBloco.text && !listAptos.contains(item["apto"])) {
        listAptos.add(item["apto"]);
      }
    }
    return listAptos;
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails('financeiro', widget.id!);
      var nome = obj['nome'].toString().split("-")[0];
      var apto = nome.split(getText('lb_bloco'))[0].split('Apto')[1].trim();
      var pago = obj["pago"] ?? 1;
      txtBloco.text = nome.toString().split('Bloco')[1].trim();
      txtApto.text = apto;
      txtReferencia.text = obj['nome'].toString().split("Ref.")[1].trim();
      txtVencimento.text = obj['data_vencimento'] ?? '';
      txtPagamento.text = pago == 1 ? obj['data'] ?? '' : '';
      txtValor.text = obj['valor'].toString();
      txtDescricao.text = obj['descricao']?.toString() ?? '';
      txtConta.text = obj['conta']?.toString() ?? '';
      txtLinhaDigitavel.text = obj['linha_digitavel']?.toString() ?? '';
      txtPixCopiaCola.text = obj['pix_copia_cola']?.toString() ?? '';
      _selectedCategoria = obj['categoria'] ?? 'Condomínio';
      _urlBoleto = obj['url_boleto'];
      id = obj['id'];
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    if (txtBloco.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Selecione o bloco.');
      return;
    }
    if (txtApto.text.trim().isEmpty) {
      displayMessage(context, getText('alert'), 'Selecione o apartamento.');
      return;
    }
    try {
      setState(() => _isSaving = true);
      var dtPag = txtPagamento.text.isNotEmpty ? convertStringToDate(txtPagamento.text) : null;
      var obj = FinanceiroModel(
        id: id,
        id_condominio: Singleton.instance.id_condominio,
        nome: "Apto ${txtApto.text} Bloco ${txtBloco.text} - Ref. ${txtReferencia.text}",
        tipo: 'C', 
        categoria: _selectedCategoria,
        data: dtPag,
        data_vencimento: convertStringToDate(txtVencimento.text),
        conta: txtConta.text, descricao: txtDescricao.text,
        valor: txtValor.text.isNotEmpty ? double.parse(txtValor.text.replaceAll('.', '').replaceAll(',', '.')) : 0.0,
        url_boleto: _urlBoleto,
        linha_digitavel: txtLinhaDigitavel.text,
        pix_copia_cola: txtPixCopiaCola.text,
      );
      var res = await apiSaveObject("financeiro", "financeiro", obj, id != null && id != -1);
      if (res.toString().isEmpty) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> delete() async {
    var choice = await showConfirmDialog(context);
    if (choice != null && choice) {
      setState(() => _isSaving = true);
      var res = await apiDeleteObject('financeiro', id);
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
      title: getText('financeiro_lancamento'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section(getText('lb_infos_apto')),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('lb_bloco'),
                          controller: txtBloco,
                          prefixIcon: PhosphorIcons.buildings,
                          readOnly: true,
                          onTap: id != -1 ? null : () {
                            if (listBlocos.isEmpty) {
                              displayMessage(context, getText('alert_ops'), getText('alert_nenhum_bloco'));
                              return;
                            }
                            bottomSheetAptos(context, listBlocos, txtBloco.text, (s) {
                              if (txtBloco.text != s) txtApto.text = '';
                              txtBloco.text = s;
                              Navigator.of(context).pop();
                              FocusManager.instance.primaryFocus?.unfocus();
                              setState(() {});
                            });
                          },
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: getText('lb_apartamento'),
                          controller: txtApto,
                          prefixIcon: PhosphorIcons.door,
                          readOnly: true,
                          onTap: id != -1 ? null : () {
                            if (getListAptos().isEmpty) {
                              displayMessage(context, getText('alert_ops'), getText('visitante_erro_bloco'));
                              return;
                            }
                            bottomSheetAptos(context, getListAptos(), txtApto.text, (s) {
                              txtApto.text = s;
                              Navigator.of(context).pop();
                              FocusManager.instance.primaryFocus?.unfocus();
                              setState(() {});
                            });
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('datas')),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('financeiro_mes_referencia'),
                          controller: txtReferencia,
                          prefixIcon: PhosphorIcons.calendarBlank,
                          keyboard: TextInputType.number,
                          formatters: [TextInputMask(mask: ['99/9999'], reverse: false)],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: getText('financeiro_data_vencimento'),
                          controller: txtVencimento,
                          prefixIcon: PhosphorIcons.calendarX,
                          readOnly: true,
                          onTap: () => showCupertinoModalPopup(
                            context: context,
                            builder: (_) => ModalCupertino(
                              onPressed: (text) => setState(() => txtVencimento.text = text),
                              initialDate: DateTime.now(),
                              minimumDate: DateTime.now().add(const Duration(days: -700)),
                              type: 'date',
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('financeiro_dt_pag'),
                    controller: txtPagamento,
                    prefixIcon: PhosphorIcons.calendarCheck,
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
                  _section("Categoria da Despesa"),
                  DropdownButtonFormField<String>(
                    value: _selectedCategoria,
                    dropdownColor: AppColors.surface(context),
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: AppColors.surface(context),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      prefixIcon: Icon(PhosphorIcons.tag, color: AppColors.primary),
                    ),
                    items: ["Condomínio", "Aluguel", "Água", "Luz", "Internet", "Outros"]
                        .map((c) => DropdownMenuItem(value: c, child: Text(c, style: AppTypography.body(context))))
                        .toList(),
                    onChanged: (val) => setState(() => _selectedCategoria = val!),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _section("Boleto Bancário (Documento)"),
                  AppButton(
                    label: _urlBoleto != null ? "Boleto Anexado ✅" : "Anexar Boleto",
                    variant: _urlBoleto != null ? AppButtonVariant.primary : AppButtonVariant.secondary,
                    onPressed: () async {
                      FilePickerResult? result = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'png'], withData: true);
                      if (result != null) {
                         setState(() { _urlBoleto = "upload_pendente"; });
                      }
                    },
                    icon: PhosphorIcons.filePdf,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _section("Pix Copia e Cola"),
                  AppInput(
                    label: "Código Pix Copia e Cola (opcional)",
                    controller: txtPixCopiaCola,
                    prefixIcon: PhosphorIcons.qrCode,
                    maxLines: 2,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _section("Código de Barras (Boleto)"),
                  AppInput(
                    label: "Linha Digitável / Código de barras (opcional)",
                    controller: txtLinhaDigitavel,
                    prefixIcon: PhosphorIcons.barcode,
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
                  if (id != -1) ...[
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
            style: AppTypography.tiny(context).copyWith(color: AppColors.primary, letterSpacing: 0.8, fontWeight: FontWeight.bold)),
      );
}

class FinanceiroModel {
  int? id, id_condominio;
  String? nome, tipo, data, data_vencimento, categoria, conta, descricao, cliente, forma_pagamento, photo, url_boleto, url_comprovante;
  String? linha_digitavel, pix_copia_cola;
  double? valor;
  int? parcelas, status;

  FinanceiroModel({this.id, this.id_condominio, this.nome, this.tipo, this.data, this.data_vencimento,
      this.valor, this.categoria, this.conta, this.descricao, this.cliente,
      this.forma_pagamento, this.parcelas, this.photo, this.url_boleto, this.url_comprovante, this.status,
      this.linha_digitavel, this.pix_copia_cola});

  Map toJson() => {
        'id': id, 'nome': nome, 'tipo': tipo, 'data': data,
        'id_condominio': id_condominio,
        'data_vencimento': data_vencimento, 'valor': valor, 'categoria': categoria,
        'conta': conta, 'descricao': descricao, 'cliente': cliente,
        'forma_pagamento': forma_pagamento, 'parcelas': parcelas, 'photo': photo,
        'url_boleto': url_boleto, 'url_comprovante': url_comprovante, 'status': status,
        'linha_digitavel': linha_digitavel, 'pix_copia_cola': pix_copia_cola
      };
}
