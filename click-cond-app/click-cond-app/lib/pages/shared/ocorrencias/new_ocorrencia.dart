import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/buttons/upload_button.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewOcorrencia extends StatefulWidget {
  const NewOcorrencia({Key? key, required this.isEdit, this.myId}) : super(key: key);
  final bool isEdit;
  final int? myId;

  @override
  _NewOcorrenciaPageState createState() => _NewOcorrenciaPageState();
}

class _NewOcorrenciaPageState extends State<NewOcorrencia> {
  List<dynamic> list = [];
  var _isLoading = false;
  var _isSaving = false;
  final txtDescricao = TextEditingController();
  var currentTipo = '';
  List<dynamic> categorias = [];
  var _publica = false;

  @override
  void dispose() {
    txtDescricao.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) {
      load();
    } else {
      loadCategorias();
    }
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("ocorrencias", widget.myId!);
      categorias = await apiGetAll("ocorrencias/categorias");
      txtDescricao.text = obj["descricao"] ?? '';
      currentTipo = obj["tipoId"].toString();
      _publica = obj["publica"] == true;
      for (var item in obj['anexos'].split(';')) {
        list.add(await fileFromImageUrl(item));
      }
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> loadCategorias() async {
    try {
      setState(() => _isLoading = true);
      categorias = await apiGetAll("ocorrencias/categorias");
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      if (currentTipo.isEmpty) {
        displayMessage(context, getText('alert_ops'), getText('ocorrencia_erro_tipo'));
        return;
      }
      List<String> base64 = [];
      for (var item in list) {
        base64.add(convertToBase64(item, 'image/png'));
      }
      var doc = OcorrenciaModel(
        id: widget.myId ?? -1,
        descricao: txtDescricao.text,
        docs: base64,
        tipo: currentTipo,
        isResposta: false,
        publica: _publica,
      );
      setState(() => _isSaving = true);
      var message = await apiSaveObject('ocorrencias', 'ocorrencia', doc, widget.isEdit);
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
      var res = await apiDeleteObject('ocorrencias', widget.myId!);
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
      title: widget.isEdit ? getText('ocorrencia_nav_edit') : getText('ocorrencia_abertura_nav'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section(getText('lb_anexos')),
                  Container(
                    decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: uploadFile(
                      title: getText('lb_insira_fotos'),
                      types: ['jpg', 'png'],
                      maxDocs: 3,
                      defaults: list,
                      onPressed: (listFiles) => setState(() => list = listFiles),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('lb_descricao')),
                  AppInput(
                    label: getText('lb_descricao'),
                    controller: txtDescricao,
                    prefixIcon: PhosphorIcons.notepad,
                    keyboard: TextInputType.multiline,
                    maxLines: 4,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('ocorrencia_tipo')),
                  ...categorias.map((categ) => Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: GestureDetector(
                          onTap: () => setState(() => currentTipo = categ["id"].toString()),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.md),
                            decoration: BoxDecoration(
                              color: currentTipo == categ["id"].toString()
                                  ? AppColors.primary.withOpacity(0.08)
                                  : AppColors.surface(context),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: currentTipo == categ["id"].toString()
                                    ? AppColors.primary
                                    : AppColors.border(context),
                              ),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  currentTipo == categ["id"].toString()
                                      ? PhosphorIcons.checkCircle
                                      : PhosphorIcons.circle,
                                  color: currentTipo == categ["id"].toString()
                                      ? AppColors.primary
                                      : AppColors.textTertiary(context),
                                  size: 20,
                                ),
                                const SizedBox(width: AppSpacing.md),
                                Text(categ["nome"], style: AppTypography.body(context)),
                              ],
                            ),
                          ),
                        ),
                      )),
                  const SizedBox(height: AppSpacing.xl),
                  _section('Visibilidade'),
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.surface(context),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Tornar ocorrência pública',
                                style: AppTypography.bodyMedium(context),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Outros moradores poderão ver esta ocorrência.',
                                style: AppTypography.caption(context),
                              ),
                            ],
                          ),
                        ),
                        Switch(
                          value: _publica,
                          onChanged: (val) => setState(() => _publica = val),
                          activeColor: AppColors.primary,
                        ),
                      ],
                    ),
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

class OcorrenciaModel {
  int? id;
  String? descricao, tipo;
  List<String>? docs;
  bool? isResposta;
  bool? publica;

  OcorrenciaModel({this.id, this.descricao, this.docs, this.tipo, this.isResposta, this.publica});

  Map toJson() => {
        'id': id,
        'descricao': descricao,
        'docs': docs,
        'tipo': tipo,
        'isResposta': isResposta,
        'publica': publica,
      };
}
