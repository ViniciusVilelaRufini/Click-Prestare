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

class NewManutencaoAreaSocial extends StatefulWidget {
  const NewManutencaoAreaSocial({Key? key, required this.isEdit, this.myId, required this.idArea, this.obj}) : super(key: key);
  final bool isEdit;
  final int? myId;
  final int idArea;
  final dynamic obj;

  @override
  _NewManutencaoAreaSocialPageState createState() => _NewManutencaoAreaSocialPageState();
}

class _NewManutencaoAreaSocialPageState extends State<NewManutencaoAreaSocial> {
  var _isLoading = false;
  var _isSaving = false;

  final txtDataInicio = TextEditingController();
  final txtDataTermino = TextEditingController();
  final txtHoraInicio = TextEditingController();
  final txtHoraTermino = TextEditingController();
  final txtDescricao = TextEditingController();

  @override
  void dispose() {
    txtDataInicio.dispose(); txtDataTermino.dispose();
    txtHoraInicio.dispose(); txtHoraTermino.dispose();
    txtDescricao.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) load();
  }

  Future<void> load() async {
    txtDataInicio.text = widget.obj['data_inicio'] ?? '';
    txtDataTermino.text = widget.obj['data_termino'] ?? '';
    txtHoraInicio.text = widget.obj['hora_inicio'] ?? '';
    txtHoraTermino.text = widget.obj['hora_termino'] ?? '';
    txtDescricao.text = widget.obj['descricao'] ?? '';
    if (mounted) setState(() {});
  }

  Future<void> save({bool confirmarCancelamentos = false}) async {
    try {
      setState(() => _isSaving = true);
      var obj = AreaSocialManutencaoModel(
        id: widget.myId ?? -1,
        id_area_social: widget.idArea,
        data_inicio: convertStringToDate(txtDataInicio.text),
        hora_inicio: convertStringToTime(txtHoraInicio.text),
        data_termino: convertStringToDate(txtDataTermino.text),
        hora_termino: convertStringToTime(txtHoraTermino.text),
        descricao: txtDescricao.text,
        confirmar_cancelamentos: confirmarCancelamentos ? true : null,
      );
      var res = await apiSaveManutencaoAreaSocial(obj, widget.isEdit);
      if (res['success'] == true) {
        if (mounted) Navigator.of(context).pop(true);
        return;
      }

      // 409: já existem reservas dentro da janela. Mostra quantas e quais
      // vão ser canceladas e só reenvia com a flag se o síndico confirmar —
      // marcar manutenção não pode apagar a reserva de alguém em silêncio.
      final conflitos = res['conflitos'];
      if (conflitos is List && conflitos.isNotEmpty) {
        final linhas = conflitos.map((c) {
          final bloco = c['bloco'] ?? '';
          final apto = c['apto'] ?? '';
          final unidade = (bloco.toString().isNotEmpty || apto.toString().isNotEmpty)
              ? '$bloco/$apto'
              : '';
          return '• ${c['data']} ${c['hora_de']}-${c['hora_ate']}${unidade.isNotEmpty ? ' ($unidade)' : ''}';
        }).join('\n');
        final texto = '${res['total']} reserva(s) serão canceladas por causa desta manutenção:\n\n$linhas\n\nDeseja continuar?';
        final confirmou = await showConfirmDialog(context, text: texto);
        if (confirmou == true) {
          await save(confirmarCancelamentos: true);
          return;
        }
        return;
      }

      if (mounted) displayMessage(context, getText('alert_error'), (res['error'] ?? '').toString());
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
      var res = await apiDeleteObject('areas-sociais/manutencao', widget.myId!);
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
      title: widget.isEdit ? getText('editar_manutencao') : getText('nova_manutencao'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _section(getText('data_inicio')),
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
            const SizedBox(height: AppSpacing.xl),
            _section(getText('data_termino')),
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
            _section(getText('lb_descricao_opcional')),
            AppInput(label: getText('lb_descricao'), controller: txtDescricao, prefixIcon: PhosphorIcons.notepad, maxLines: 3),
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

class AreaSocialManutencaoModel {
  int? id;
  int? id_area_social;
  String? data_inicio;
  String? hora_inicio;
  String? data_termino;
  String? hora_termino;
  String? descricao;
  // Só vai no payload quando o síndico confirmou o cancelamento das reservas
  // atingidas (segunda chamada, depois do 409). `null` some do JSON — versões
  // antigas do app nunca mandam essa chave, o que é o comportamento esperado.
  bool? confirmar_cancelamentos;

  AreaSocialManutencaoModel({this.id, this.id_area_social, this.data_inicio,
      this.hora_inicio, this.data_termino, this.hora_termino, this.descricao,
      this.confirmar_cancelamentos});

  Map toJson() => {
        'id': id, 'id_area_social': id_area_social,
        'data_inicio': data_inicio, 'hora_inicio': hora_inicio,
        'data_termino': data_termino, 'hora_termino': hora_termino,
        'descricao': descricao,
        if (confirmar_cancelamentos == true) 'confirmar_cancelamentos': true,
      };
}
