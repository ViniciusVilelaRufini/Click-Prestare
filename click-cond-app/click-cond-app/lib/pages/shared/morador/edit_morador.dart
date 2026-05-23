import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/pages/shared/morador/new_morador.dart';
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
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class EditMorador extends StatefulWidget {
  const EditMorador({Key? key}) : super(key: key);

  @override
  _EditMoradorPageState createState() => _EditMoradorPageState();
}

class _EditMoradorPageState extends State<EditMorador> {
  var _isLoading = false;
  var _isSaving = false;
  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtDN = TextEditingController();
  final txtEmail = TextEditingController();
  final txtTelefone = TextEditingController();
  final txtExtra1 = TextEditingController();
  final txtExtra2 = TextEditingController();
  final txtExtra3 = TextEditingController();
  final txtExtra4 = TextEditingController();

  dynamic imageFile;
  var changed = false;
  var myId = -1;

  @override
  void dispose() {
    txtNome.dispose(); txtDocumento.dispose(); txtDN.dispose();
    txtEmail.dispose(); txtTelefone.dispose();
    txtExtra1.dispose(); txtExtra2.dispose(); txtExtra3.dispose(); txtExtra4.dispose();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      setState(() => _isLoading = true);
      var obj = await apiGetDetails("moradores", 0);
      myId = obj["id"] ?? -1;
      txtNome.text = obj["nome"] ?? "";
      txtDocumento.text = obj["documento"] ?? "";
      txtEmail.text = obj["email"] ?? "";
      txtDN.text = obj["data_nascimento"] ?? "";
      txtTelefone.text = obj["telefone"] ?? "";
      txtExtra1.text = obj["extra1"] ?? '';
      txtExtra2.text = obj["extra2"] ?? '';
      txtExtra3.text = obj["extra3"] ?? '';
      txtExtra4.text = obj["extra4"] ?? '';
      imageFile = obj['photo'] != null && obj['photo'].toString().isNotEmpty ? obj['photo'] : null;
      if (mounted) setState(() {});
    } catch (e) {
      if (mounted) await displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      String? base64;
      if (imageFile != null && changed) {
        base64 = convertToBase64(imageFile, "image/jpeg");
      } else if (imageFile is String) {
        base64 = imageFile;
      }
      var morador = MoradorModel(
        id: myId, nome: txtNome.text, documento: txtDocumento.text,
        data_nascimento: txtDN.text, email: txtEmail.text, telefone: txtTelefone.text,
        extra1: txtExtra1.text, extra2: txtExtra2.text,
        extra3: txtExtra3.text, extra4: txtExtra4.text, photo: base64,
      );
      var res = await updateMoradorApi(morador);
      if (res.toString().isEmpty) {
        await displayMessage(context, getText('alert_success'), getText('alert_dados_alterados'));
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

  Future<void> _selectPhoto() async {
    var res = await getPhoto(context);
    imageFile = res;
    changed = true;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('editar_infos'),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: GestureDetector(
                      onTap: _selectPhoto,
                      child: Stack(
                        children: [
                          CircleAvatar(
                            radius: 52,
                            backgroundColor: AppColors.primary.withOpacity(0.1),
                            backgroundImage: imageFile == null
                                ? const AssetImage('assets/images/defaultUser.png')
                                : (imageFile is String
                                    ? NetworkImage(imageFile)
                                    : (kIsWeb
                                        ? NetworkImage(imageFile.path)
                                        : FileImage(io.File(imageFile.path)))) as ImageProvider,
                          ),
                          Positioned(
                            bottom: 0, right: 0,
                            child: Container(
                              width: 30, height: 30,
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                                border: Border.all(color: AppColors.bg(context), width: 2),
                              ),
                              child: const Icon(PhosphorIcons.camera, size: 16, color: Colors.white),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_infos_pessoais')),
                  AppInput(label: getText('user_nome_completo'), controller: txtNome, prefixIcon: PhosphorIcons.user, textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('user_documento'), controller: txtDocumento, prefixIcon: PhosphorIcons.identificationCard),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('data_nascimento'),
                    controller: txtDN,
                    prefixIcon: PhosphorIcons.calendarBlank,
                    readOnly: true,
                    onTap: () => showCupertinoModalPopup(
                      context: context,
                      builder: (_) => ModalCupertino(
                        onPressed: (text) => setState(() => txtDN.text = text),
                        initialDate: null,
                        type: 'date',
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('signup_infos_contato')),
                  AppInput(label: getText('email'), controller: txtEmail, prefixIcon: PhosphorIcons.envelope, keyboard: TextInputType.emailAddress),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('telefone'), controller: txtTelefone, prefixIcon: PhosphorIcons.phone, keyboard: TextInputType.phone),
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
