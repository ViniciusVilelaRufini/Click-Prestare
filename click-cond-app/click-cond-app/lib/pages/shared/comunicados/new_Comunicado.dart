import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewComunicado extends StatefulWidget {
  const NewComunicado({super.key, required this.isEdit, this.myId});
  final bool isEdit;
  final int? myId;
  @override
  _NewComunicadoPageState createState() => _NewComunicadoPageState();
}

class _NewComunicadoPageState extends State<NewComunicado> {
  bool _isLoading = false;
  final txtTitulo = TextEditingController();
  final txtDescricao = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (widget.isEdit) load();
  }

  @override
  void dispose() {
    txtTitulo.dispose();
    txtDescricao.dispose();
    super.dispose();
  }

  Future<void> load() async {
    _setLoading(true);
    final obj = await apiGetDetails("comunicados", widget.myId!);
    if (obj != null) {
      txtTitulo.text = obj["titulo"];
      txtDescricao.text = obj["descricao"];
    }
    _setLoading(false);
  }

  Future<void> save() async {
    try {
      _setLoading(true);
      final obj = ComunicadoModel(id: widget.myId ?? -1, titulo: txtTitulo.text, descricao: txtDescricao.text);
      final res = await apiSaveObject("comunicados", "comunicado", obj, widget.isEdit);
      if (res.toString().isEmpty) {
        if (mounted) Navigator.of(context).pop(true);
      } else {
        if (mounted) displayMessage(context, getText('alert_error'), res.toString());
      }
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      _setLoading(false);
    }
  }

  Future<void> delete() async {
    final choice = await showConfirmDialog(context);
    if (choice != true) return;
    _setLoading(true);
    final res = await apiDeleteObject('comunicados', widget.myId!);
    _setLoading(false);
    if (res) {
      if (mounted) { Navigator.of(context).pop(true); Navigator.of(context).pop(true); }
    } else {
      if (mounted) displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    }
  }

  void _setLoading(bool v) { if (mounted) setState(() => _isLoading = v); }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: widget.isEdit ? getText('comunicado_nav_edit') : getText('comunicado_nav_new'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: AppSpacing.sm),
            Text(getText('comunicados_infos'), style: AppTypography.captionMedium(context).copyWith(color: AppColors.primary)),
            const SizedBox(height: AppSpacing.lg),
            AppInput(label: getText('lb_titulo'), controller: txtTitulo, prefixIcon: PhosphorIcons.textT),
            const SizedBox(height: AppSpacing.md),
            AppInput(label: getText('lb_descricao'), controller: txtDescricao, maxLines: 6),
            const SizedBox(height: AppSpacing.xl),
            AppButton(label: getText('btn_save'), onPressed: _isLoading ? null : save, loading: _isLoading),
            if (widget.isEdit) ...[
              const SizedBox(height: AppSpacing.md),
              AppButton(
                label: getText('btn_delete'),
                onPressed: _isLoading ? null : delete,
                variant: AppButtonVariant.danger,
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }
}

class ComunicadoModel {
  int? id;
  String? titulo;
  String? descricao;
  ComunicadoModel({this.id, this.titulo, this.descricao});
  Map toJson() => {'id': id, 'titulo': titulo, 'descricao': descricao};
}
