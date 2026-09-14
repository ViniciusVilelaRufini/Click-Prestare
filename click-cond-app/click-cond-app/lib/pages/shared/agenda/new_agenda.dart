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
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewAgenda extends StatefulWidget {
  const NewAgenda({super.key, required this.isEdit, this.myId});
  final bool isEdit;
  final int? myId;

  @override
  _NewAgendaPageState createState() => _NewAgendaPageState();
}

class _NewAgendaPageState extends State<NewAgenda> {
  var _isLoading = false;
  var _isSaving = false;
  final txtTitulo = TextEditingController();
  final txtDataInicio = TextEditingController();
  final txtDataTermino = TextEditingController();
  final txtHoraInicio = TextEditingController();
  final txtHoraTermino = TextEditingController();
  final txtDescricao = TextEditingController();

  @override
  void dispose() {
    txtTitulo.dispose(); txtDataInicio.dispose(); txtDataTermino.dispose();
    txtHoraInicio.dispose(); txtHoraTermino.dispose(); txtDescricao.dispose();
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
      var obj = await apiGetDetails("agenda", widget.myId!);
      txtTitulo.text = obj["titulo"] ?? '';
      txtDataInicio.text = obj["data_inicio"] ?? '';
      txtDataTermino.text = obj["data_termino"] ?? '';
      txtHoraInicio.text = obj["hora_inicio"] ?? '';
      txtHoraTermino.text = obj["hora_termino"] ?? '';
      txtDescricao.text = obj["descricao"] ?? '';
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      var obj = AgendaModel(
        id: widget.myId ?? -1,
        titulo: txtTitulo.text,
        data_inicio: convertStringToDate(txtDataInicio.text),
        data_termino: convertStringToDate(txtDataTermino.text),
        hora_inicio: convertStringToTime(txtHoraInicio.text),
        hora_termino: convertStringToTime(txtHoraTermino.text),
        descricao: txtDescricao.text,
        alertar: true,
      );
      setState(() => _isSaving = true);
      var res = await apiSaveObject("agenda", "agenda", obj, widget.isEdit);
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
      var res = await apiDeleteObject('agenda', widget.myId!);
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
      title: widget.isEdit ? getText('editar_manutencao') : getText('nova_manutencao'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _section(getText('manut_about')),
                  AppInput(label: getText('lb_titulo'), controller: txtTitulo, prefixIcon: PhosphorIcons.wrench, textCapitalization: TextCapitalization.sentences),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('lb_descricao'), controller: txtDescricao, prefixIcon: PhosphorIcons.notepad, maxLines: 3),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('data_e_hora').toUpperCase()),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('data_inicio'),
                          controller: txtDataInicio,
                          prefixIcon: PhosphorIcons.calendarBlank,
                          readOnly: true,
                          onTap: () => showCupertinoModalPopup(
                            context: context,
                            builder: (_) => ModalCupertino(
                              onPressed: (text) => setState(() => txtDataInicio.text = text),
                              initialDate: DateTime.now(), type: 'date',
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: getText('hora_inicio'),
                          controller: txtHoraInicio,
                          prefixIcon: PhosphorIcons.clock,
                          readOnly: true,
                          onTap: () => showCupertinoModalPopup(
                            context: context,
                            builder: (_) => ModalCupertino(
                              onPressed: (text) => setState(() => txtHoraInicio.text = text),
                              initialDate: null, type: 'time',
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Row(
                    children: [
                      Expanded(
                        child: AppInput(
                          label: getText('data_termino'),
                          controller: txtDataTermino,
                          prefixIcon: PhosphorIcons.calendarCheck,
                          readOnly: true,
                          onTap: () => showCupertinoModalPopup(
                            context: context,
                            builder: (_) => ModalCupertino(
                              onPressed: (text) => setState(() => txtDataTermino.text = text),
                              initialDate: convertStringToDateFormat(txtDataInicio.text) ?? DateTime.now(),
                              type: 'date',
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppInput(
                          label: getText('hora_termino'),
                          controller: txtHoraTermino,
                          prefixIcon: PhosphorIcons.clockAfternoon,
                          readOnly: true,
                          onTap: () => showCupertinoModalPopup(
                            context: context,
                            builder: (_) => ModalCupertino(
                              onPressed: (text) => setState(() => txtHoraTermino.text = text),
                              initialDate: null, type: 'time',
                            ),
                          ),
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

class AgendaModel {
  int? id;
  String? titulo, data_inicio, data_termino, hora_inicio, hora_termino, descricao;
  bool? alertar;

  AgendaModel({this.id, this.titulo, this.data_inicio, this.data_termino,
      this.hora_inicio, this.hora_termino, this.descricao, this.alertar});

  Map toJson() => {
        'id': id, 'titulo': titulo, 'data_inicio': data_inicio,
        'data_termino': data_termino, 'hora_inicio': hora_inicio,
        'hora_termino': hora_termino, 'descricao': descricao, 'alertar': alertar,
      };
}
