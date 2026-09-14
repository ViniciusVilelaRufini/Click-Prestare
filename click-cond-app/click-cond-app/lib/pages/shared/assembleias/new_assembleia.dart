
import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:click/widgets/buttons/upload_button.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewAssembleia extends StatefulWidget {
  const NewAssembleia({super.key, required this.isEdit, this.myId});
  final bool isEdit;
  final int? myId;

  @override
  _NewAssembleiaPageState createState() => _NewAssembleiaPageState();
}

class _NewAssembleiaPageState extends State<NewAssembleia> {
  List<dynamic> list = [];
  var _isLoading = false;
  var _isSaving = false;
  final txtTitulo = TextEditingController();
  final txtDescricao = TextEditingController();
  final txtData = TextEditingController();
  final txtHora = TextEditingController();
  final txtLocal = TextEditingController();
  final txtLink = TextEditingController();

  @override
  void dispose() {
    txtTitulo.dispose(); txtDescricao.dispose(); txtData.dispose();
    txtHora.dispose(); txtLocal.dispose(); txtLink.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("assembleias", widget.myId!);
      if (obj == null) throw getText('alert_generic_error');
      txtTitulo.text = obj["assembleia"]["titulo"] ?? '';
      txtDescricao.text = obj["assembleia"]["descricao"] ?? '';
      txtData.text = obj["assembleia"]["data"] ?? '';
      txtHora.text = obj["assembleia"]["hora"] ?? '';
      txtLocal.text = obj["assembleia"]["local"] ?? '';
      txtLink.text = obj["assembleia"]["link"] ?? '';
      for (var item in obj["assembleia"]['anexos'].split(';')) {
        if (item.toString().isNotEmpty) list.add(await fileFromPdfUrl(item));
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
      setState(() => _isSaving = true);
      List<String> base64 = [];
      for (var item in list) {
        base64.add(convertToBase64(item, 'application/pdf'));
      }
      var obj = AssembleiaModel(
        id: widget.myId ?? -1, titulo: txtTitulo.text, descricao: txtDescricao.text,
        data: convertStringToDate(txtData.text), hora: convertStringToTime(txtHora.text),
        local: txtLocal.text, link: txtLink.text, docs: base64,
      );
      var res = await apiSaveObject("assembleias", "assembleia", obj, widget.isEdit);
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
      var res = await apiDeleteObject('assembleias', widget.myId!);
      if (mounted) setState(() => _isSaving = false);
      if (res) {
        if (mounted) {
          Navigator.of(context).pop(true);
          Navigator.of(context).pop(true);
        }
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: widget.isEdit ? getText('assembleia_nav_edit') : getText('assembleia_nav_new'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section(getText('assembleia_infos')),
                  AppInput(label: getText('lb_titulo'), controller: txtTitulo, prefixIcon: PhosphorIcons.usersThree, textCapitalization: TextCapitalization.sentences),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('lb_descricao'), controller: txtDescricao, prefixIcon: PhosphorIcons.notepad, maxLines: 3),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('assembleia_data_local')),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('data'),
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
                          label: getText('hora'),
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
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('assembleia_local'), controller: txtLocal, prefixIcon: PhosphorIcons.mapPin),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('lb_complementos').toUpperCase()),
                  AppInput(label: getText('assembleia_link_online'), controller: txtLink, prefixIcon: PhosphorIcons.link, keyboard: TextInputType.url),
                  const SizedBox(height: AppSpacing.md),
                  Container(
                    decoration: BoxDecoration(color: AppColors.surface(context), borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.all(AppSpacing.md),
                    child: uploadFile(
                      title: getText('assembleia_arquivos'),
                      types: ['pdf'],
                      maxDocs: 3,
                      defaults: list,
                      onPressed: (listFiles) => setState(() => list = listFiles),
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

class AssembleiaModel {
  int? id;
  String? titulo, descricao, data, hora, local, link;
  List<String>? docs;

  AssembleiaModel({this.id, this.titulo, this.descricao, this.data, this.hora, this.local, this.link, this.docs});

  Map toJson() => {
        'id': id, 'titulo': titulo, 'descricao': descricao, 'data': data,
        'hora': hora, 'local': local, 'link': link, 'docs': docs,
      };
}
