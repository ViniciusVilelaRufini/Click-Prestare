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
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewVotacao extends StatefulWidget {
  const NewVotacao({super.key, this.idAssembleia, required this.isEnquete});
  final int? idAssembleia;
  final bool? isEnquete;

  @override
  _NewVotacaoPageState createState() => _NewVotacaoPageState();
}

class _NewVotacaoPageState extends State<NewVotacao> {
  var _isSaving = false;

  final txtNome = TextEditingController();
  final txtDescricao = TextEditingController();
  final txtDataInicio = TextEditingController();
  final txtDataTermino = TextEditingController();
  final txtOpcao1 = TextEditingController();
  final txtOpcao2 = TextEditingController();
  final txtOpcao3 = TextEditingController();
  final txtOpcao4 = TextEditingController();

  @override
  void dispose() {
    txtNome.dispose(); txtDescricao.dispose(); txtDataInicio.dispose();
    txtDataTermino.dispose(); txtOpcao1.dispose(); txtOpcao2.dispose();
    txtOpcao3.dispose(); txtOpcao4.dispose();
    super.dispose();
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      List<String> ops = [];
      if (txtOpcao1.text.isNotEmpty) ops.add(txtOpcao1.text);
      if (txtOpcao2.text.isNotEmpty) ops.add(txtOpcao2.text);
      if (txtOpcao3.text.isNotEmpty) ops.add(txtOpcao3.text);
      if (txtOpcao4.text.isNotEmpty) ops.add(txtOpcao4.text);

      if (ops.isEmpty) throw getText('votacao_signup_informe_opcoes');

      var obj = VotacaoModel(
        titulo: txtNome.text,
        descricao: txtDescricao.text,
        data_inicio: convertStringToDate(txtDataInicio.text),
        data_termino: convertStringToDate(txtDataTermino.text),
        id_assembleia: widget.idAssembleia ?? 0,
        is_enquete: widget.isEnquete,
        opcoes: ops,
      );

      var res = await apiSaveObject("assembleias/votacoes", "votacao", obj, false);
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('votacao_signup_nav'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _section(getText('votacao_signup_infos')),
            AppInput(label: getText('lb_titulo'), controller: txtNome, prefixIcon: PhosphorIcons.listBullets, textCapitalization: TextCapitalization.sentences),
            const SizedBox(height: AppSpacing.md),
            if (widget.isEnquete == true) ...[
              AppInput(label: getText('lb_descricao'), controller: txtDescricao, prefixIcon: PhosphorIcons.notepad, maxLines: 3),
              const SizedBox(height: AppSpacing.md),
            ],
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
                    label: getText('votacao_signup_dt_encerramento'),
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
              ],
            ),
            const SizedBox(height: AppSpacing.xl),
            _section(getText('votacao_opcoes')),
            AppInput(label: '${getText('votacao_opcao')} 1', controller: txtOpcao1, prefixIcon: PhosphorIcons.circle, textCapitalization: TextCapitalization.sentences),
            const SizedBox(height: AppSpacing.sm),
            AppInput(label: '${getText('votacao_opcao')} 2', controller: txtOpcao2, prefixIcon: PhosphorIcons.circle, textCapitalization: TextCapitalization.sentences),
            const SizedBox(height: AppSpacing.sm),
            AppInput(label: '${getText('votacao_opcao')} 3', controller: txtOpcao3, prefixIcon: PhosphorIcons.circle, textCapitalization: TextCapitalization.sentences),
            const SizedBox(height: AppSpacing.sm),
            AppInput(label: '${getText('votacao_opcao')} 4', controller: txtOpcao4, prefixIcon: PhosphorIcons.circle, textCapitalization: TextCapitalization.sentences),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: getText('btn_save'),
              onPressed: _isSaving ? null : save,
              loading: _isSaving,
              icon: PhosphorIcons.floppyDisk,
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
            style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary, letterSpacing: 0.8)),
      );
}

class VotacaoModel {
  String? titulo;
  String? descricao;
  String? data_inicio;
  String? hora_inicio;
  String? data_termino;
  String? hora_termino;
  bool? is_enquete;
  int? id_assembleia;
  List<String>? opcoes;

  VotacaoModel({this.titulo, this.descricao, this.data_inicio, this.hora_inicio,
      this.data_termino, this.hora_termino, this.is_enquete, this.id_assembleia, this.opcoes});

  Map toJson() => {
        'titulo': titulo, 'descricao': descricao, 'data_inicio': data_inicio,
        'hora_inicio': hora_inicio, 'data_termino': data_termino,
        'hora_termino': hora_termino, 'is_enquete': is_enquete,
        'id_assembleia': id_assembleia, 'opcoes': opcoes,
      };
}
