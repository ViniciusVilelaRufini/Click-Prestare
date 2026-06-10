import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/pages/shared/funcionarios/new_funcionario_1.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class EditFuncionario extends StatefulWidget {
  const EditFuncionario({Key? key}) : super(key: key);

  @override
  _EditFuncionarioPageState createState() => _EditFuncionarioPageState();
}

class _EditFuncionarioPageState extends State<EditFuncionario> {
  var _isLoading = false;
  var _isSaving = false;
  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtEmail = TextEditingController();
  final txtTelefone = TextEditingController();

  dynamic imageFile;
  var changed = false;
  var myId = -1;

  @override
  void dispose() {
    txtNome.dispose(); txtDocumento.dispose();
    txtEmail.dispose(); txtTelefone.dispose();
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
      var obj = await apiGetDetails("funcionarios", 0);
      myId = obj["id"] ?? -1;
      txtNome.text = obj["nome"] ?? "";
      txtDocumento.text = obj["documento"] ?? "";
      txtEmail.text = obj["email"] ?? "";
      txtTelefone.text = obj["telefone"] ?? "";
      imageFile = obj['photo'] != null && obj['photo'].toString().isNotEmpty ? obj['photo'] : null;
      if (imageFile != null && imageFile.toString().startsWith('http')) {
        setUserPhoto(imageFile.toString());
      }
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
      var funcionario = FuncionarioModel(
        id: myId, nome: txtNome.text, documento: txtDocumento.text,
        email: txtEmail.text, telefone: txtTelefone.text, photo: base64,
      );
      var res = await updateFuncionarioApi(funcionario);
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
                                color: AppColors.primary, shape: BoxShape.circle,
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
                  AppInput(label: getText('user_nome_completo'), controller: txtNome, prefixIcon: PhosphorIcons.user, textCapitalization: TextCapitalization.words),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(label: getText('user_documento'), controller: txtDocumento, prefixIcon: PhosphorIcons.identificationCard),
                  const SizedBox(height: AppSpacing.md),
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
}
