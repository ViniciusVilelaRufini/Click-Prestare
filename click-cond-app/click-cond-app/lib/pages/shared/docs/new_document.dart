
import 'package:click/controllers/controller_generic.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/buttons/upload_button.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class NewDocument extends StatefulWidget {
  const NewDocument({super.key, required this.is_ata});
  final bool is_ata;

  @override
  _NewDocumentPageState createState() => _NewDocumentPageState();
}

class _NewDocumentPageState extends State<NewDocument> {
  List<dynamic> list = [];
  var _isSaving = false;
  final txtTitulo = TextEditingController();

  @override
  void dispose() {
    txtTitulo.dispose();
    super.dispose();
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      var base64 = convertToBase64(list[0], 'application/pdf');
      var doc = DocumentoModel(nome: txtTitulo.text, is_ata: widget.is_ata, doc: base64);
      var message = await apiSaveObject('documentos', 'documento', doc, false);
      if (message == '') {
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('docs_nav_new'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _section(getText('docs_title')),
            AppInput(label: getText('docs_title'), controller: txtTitulo, prefixIcon: PhosphorIcons.fileText, textCapitalization: TextCapitalization.sentences),
            const SizedBox(height: AppSpacing.xl),
            _section(getText('docs_upload')),
            Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.surface(context),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border(context)),
              ),
              child: uploadFile(
                title: getText('docs_upload'),
                types: ['pdf'],
                maxDocs: 1,
                onPressed: (listFiles) {
                  list = listFiles;
                },
              ),
            ),
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

class DocumentoModel {
  String? nome;
  String? doc;
  bool? is_ata;

  DocumentoModel({this.nome, this.doc, this.is_ata});

  Map toJson() => {'nome': nome, 'doc': doc, 'is_ata': is_ata};
}
