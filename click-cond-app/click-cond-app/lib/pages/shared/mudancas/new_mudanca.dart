import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/bottom_sheet_aptos.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import '../../singleton.dart';

class NewMudanca extends StatefulWidget {
  const NewMudanca({super.key, required this.isEdit, this.myId});
  final bool isEdit;
  final int? myId;

  @override
  _NewMudancaPageState createState() => _NewMudancaPageState();
}

class _NewMudancaPageState extends State<NewMudanca> {
  final txtData = TextEditingController();
  final txtHora = TextEditingController();
  final txtBloco = TextEditingController();
  final txtApto = TextEditingController();

  var _isLoading = false;
  var _isSaving = false;
  var idMyApartment;
  var list = [];
  var listBlocos = [];

  @override
  void dispose() {
    txtData.dispose(); txtHora.dispose(); txtBloco.dispose(); txtApto.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) load();
    if (getUserType() == 'morador') {
      txtBloco.text = Singleton.instance.bloco;
      txtApto.text = Singleton.instance.apartamento;
      idMyApartment = Singleton.instance.id_apartamento;
    } else {
      loadListAptos();
    }
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("mudancas", widget.myId!);
      txtData.text = obj["data"] ?? '';
      txtHora.text = obj["hora_inicio"] ?? '';
      txtApto.text = obj["apto"] ?? '';
      txtBloco.text = obj["apto_bloco"] ?? '';
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
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
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      var mudanca = MudancaModel(
        id: widget.myId ?? -1,
        data: convertStringToDate(txtData.text),
        hora_inicio: txtHora.text,
        id_apartamento: idMyApartment ?? getIdApto(),
      );
      setState(() => _isSaving = true);
      var message = await apiSaveObject('mudancas', 'mudanca', mudanca, widget.isEdit);
      if (message == "") {
        if (mounted) Navigator.pop(context);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), message);
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
      var res = await apiDeleteObject('mudancas', widget.myId!);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
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

  getIdApto() {
    for (var item in list) {
      if (item['bloco'] == txtBloco.text && item["apto"] == txtApto.text) return item["id"];
    }
    throw getText('mudanca_selecione_apto');
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: widget.isEdit ? getText('mudanca_nav_edit') : getText('mudanca_nav_new'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section(getText('mudanca_infos_mudanca')),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('data_hora_inicio'),
                          controller: txtData,
                          prefixIcon: PhosphorIcons.calendarBlank,
                          readOnly: true,
                          onTap: () => showCupertinoModalPopup(
                            context: context,
                            builder: (_) => ModalCupertino(
                              onPressed: (text) => setState(() => txtData.text = text),
                              initialDate: DateTime.now(), type: 'date',
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: getText('hora_inicio'),
                          controller: txtHora,
                          prefixIcon: PhosphorIcons.clock,
                          readOnly: true,
                          onTap: () => showCupertinoModalPopup(
                            context: context,
                            builder: (_) => ModalCupertino(
                              onPressed: (text) => setState(() => txtHora.text = text),
                              initialDate: null, type: 'time',
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('lb_infos_apto')),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('lb_bloco'),
                          controller: txtBloco,
                          prefixIcon: PhosphorIcons.buildings,
                          readOnly: true,
                          onTap: getUserType() == 'morador' ? null : () {
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
                          onTap: getUserType() == 'morador' ? null : () {
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
                  AppButton(
                    label: getText('btn_save'),
                    onPressed: _isSaving ? null : save,
                    loading: _isSaving,
                    icon: PhosphorIcons.floppyDisk,
                  ),
                  if (widget.isEdit) ...[
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

class MudancaModel {
  int? id;
  String? data, hora_inicio;
  int? id_apartamento;

  MudancaModel({this.id, this.data, this.hora_inicio, this.id_apartamento});

  Map toJson() => {'id': id, 'data': data, 'hora_inicio': hora_inicio, 'id_apartamento': id_apartamento};
}
