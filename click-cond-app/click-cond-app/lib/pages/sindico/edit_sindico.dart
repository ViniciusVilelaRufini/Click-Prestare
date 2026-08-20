import 'dart:convert';
import 'dart:io' as io;
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_condominio.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/alerts/modal_cupertino.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class EditSindico extends StatefulWidget {
  const EditSindico({Key? key}) : super(key: key);

  @override
  _EditSindicoPageState createState() => _EditSindicoPageState();
}

class _EditSindicoPageState extends State<EditSindico> {
  dynamic imageFile;
  var _isLoading = false;
  var _isSaving = false;
  var changed = false;

  final txtNome = TextEditingController();
  final txtDocumento = TextEditingController();
  final txtDN = TextEditingController();
  final txtEmail = TextEditingController();
  final txtTelefone = TextEditingController();

  @override
  void dispose() {
    txtNome.dispose();
    txtDocumento.dispose();
    txtDN.dispose();
    txtEmail.dispose();
    txtTelefone.dispose();
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
      var obj = await apiGetDetails("sindico", 0); 
      txtNome.text = obj["name"] ?? "";
      txtEmail.text = obj["email"] ?? "";
      txtDN.text = obj["date_birth"] ?? "";
      txtTelefone.text = obj["phone"] ?? "";
      txtDocumento.text = obj["doc_identification"] ?? "";
      
      final photoUrl = obj['photo'] != null && obj['photo'].toString().isNotEmpty 
          ? obj['photo'] 
          : (getUserPhoto().isNotEmpty ? getUserPhoto() : null);
      imageFile = photoUrl;
      if (photoUrl != null && photoUrl.toString().startsWith('http')) {
        setUserPhoto(photoUrl.toString());
      }
      
      setState(() {});
    } catch (e) {
      if (mounted) {
        await displayMessage(context, getText('alert_error'), getText('alert_generic_error'));
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _selectPhoto() async {
    var res = await getPhoto(context);
    if (res != null) {
      imageFile = res;
      changed = true;
      setState(() {});
    }
  }

  Future<void> save() async {
    try {
      if (txtDN.text.trim().isNotEmpty && !validateDate(txtDN.text)) {
        displayMessage(context, getText('alert_error'), getText('signup_erro_dt_nascimento'));
        return;
      }
      
      setState(() => _isSaving = true);
      
      String? base64;
      if (imageFile != null && changed) {
        base64 = convertToBase64(imageFile, "image/jpeg");
      } else if (imageFile is String) {
        base64 = imageFile;
      }
      
      await updateSindico(
        txtNome.text, 
        txtDocumento.text, 
        txtDN.text, 
        txtEmail.text.trim(), 
        txtTelefone.text, 
        base64
      );          
      
      if (mounted) {
        await displayMessage(context, getText('alert_success'), getText('alert_dados_alterados'));
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        await displayMessage(context, getText('alert_error'), e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  Future<void> _deleteAccount() async {
    final ok = await showAppConfirmDialog(
      context,
      title: 'Excluir minha conta',
      message: 'Tem certeza que deseja excluir sua conta permanentemente? Esta ação é irreversível e todos os seus dados serão apagados.',
      confirmLabel: 'Excluir Conta',
      isDanger: true,
    );
    if (!ok) return;

    final success = await apiDeleteAccount();
    if (!mounted) return;

    if (success) {
      await showAppDialog(
        context,
        title: 'Conta Excluída',
        message: 'Sua conta foi excluída com sucesso.',
        icon: PhosphorIcons.checkCircle,
        iconColor: AppColors.success,
      );
      await storageLogout();
      if (!mounted) return;
      Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
    } else {
      showAppDialog(
        context,
        title: 'Erro',
        message: 'Não foi possível excluir a conta agora. Tente novamente mais tarde.',
        icon: PhosphorIcons.warningCircle,
        iconColor: AppColors.error,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('sindico_nav_edit'),
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
                            bottom: 0,
                            right: 0,
                            child: Container(
                              width: 30,
                              height: 30,
                              decoration: BoxDecoration(
                                color: AppColors.primary,
                                shape: BoxShape.circle,
                                border: Border.all(color: AppColors.bg(context), width: 2),
                              ),
                              child: const Icon(
                                PhosphorIcons.camera,
                                size: 16,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  _section(getText('funcionario_infos_pessoais')),
                  AppInput(
                    label: getText('user_nome_completo'),
                    controller: txtNome,
                    prefixIcon: PhosphorIcons.user,
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: getText('user_documento'),
                    controller: txtDocumento,
                    prefixIcon: PhosphorIcons.identificationCard,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: '${getText('data_nascimento')} (Opcional)',
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
                  AppInput(
                    label: getText('email'),
                    controller: txtEmail,
                    prefixIcon: PhosphorIcons.envelope,
                    keyboard: TextInputType.emailAddress,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  AppInput(
                    label: '${getText('telefone')} (Opcional)',
                    controller: txtTelefone,
                    prefixIcon: PhosphorIcons.phone,
                    keyboard: TextInputType.phone,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  AppButton(
                    label: getText('btn_save'),
                    onPressed: _isSaving ? null : save,
                    loading: _isSaving,
                    icon: PhosphorIcons.floppyDisk,
                  ),
                  const SizedBox(height: AppSpacing.xxl),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      color: AppColors.error.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.error.withOpacity(0.25)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(PhosphorIcons.warningCircle, color: AppColors.error, size: 18),
                            const SizedBox(width: AppSpacing.xs),
                            Text(
                              'Zona de Perigo',
                              style: AppTypography.captionMedium(context).copyWith(
                                fontWeight: FontWeight.bold,
                                color: AppColors.error,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Text(
                          'Ao excluir sua conta, todos os seus dados serão removidos permanentemente.',
                          style: AppTypography.caption(context).copyWith(
                            color: AppColors.textSecondary(context),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: _deleteAccount,
                            icon: const Icon(PhosphorIcons.trash, size: 16),
                            label: const Text('Excluir minha conta'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppColors.error,
                              side: BorderSide(color: AppColors.error.withOpacity(0.5)),
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xxxl),
                ],
              ),
            ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Text(
          title.toUpperCase(),
          style: AppTypography.captionMedium(context).copyWith(
            color: AppColors.primary,
            letterSpacing: 0.8,
          ),
        ),
      );
}
