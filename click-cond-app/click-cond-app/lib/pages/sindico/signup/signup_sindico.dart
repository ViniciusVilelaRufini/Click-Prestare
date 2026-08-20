import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/list_condominiums.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:easy_mask/easy_mask.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class SignupSindico extends StatefulWidget {
  const SignupSindico({Key? key}) : super(key: key);

  @override
  _SignupSindicoPageState createState() => _SignupSindicoPageState();
}

class _SignupSindicoPageState extends State<SignupSindico> {
  dynamic _imageFile;
  var _isLoading = false;

  final _txtNome = TextEditingController();
  final _txtDocumento = TextEditingController();
  final _txtDN = TextEditingController();
  final _txtEmail = TextEditingController();
  final _txtTelefone = TextEditingController();
  final _txtPassword = TextEditingController();

  @override
  void dispose() {
    _txtNome.dispose();
    _txtDocumento.dispose();
    _txtDN.dispose();
    _txtEmail.dispose();
    _txtTelefone.dispose();
    _txtPassword.dispose();
    super.dispose();
  }

  Future<void> _selectPhoto() async {
    final res = await getPhoto(context);
    if (res == null) return;
    setState(() => _imageFile = res);
  }

  ImageProvider _getAvatarImage() {
    if (_imageFile == null) return const AssetImage('assets/images/defaultUser.png');
    if (kIsWeb) return NetworkImage(_imageFile.path);
    return const AssetImage('assets/images/defaultUser.png');
  }

  Future<void> _signup() async {
    if (_isLoading) return;
    if (_txtDN.text.trim().isNotEmpty && !validateDate(_txtDN.text)) {
      displayMessage(context, getText('alert_error'), getText('signup_erro_dt_nascimento'));
      return;
    }

    setState(() => _isLoading = true);

    String? base64;
    if (_imageFile != null) {
      final bytes = await _imageFile.readAsBytes();
      base64 = "data:image/png;base64," + base64Encode(bytes);
    }

    final message = await signupSindico(
      _txtNome.text, _txtDocumento.text, _txtDN.text,
      _txtEmail.text.trim(), _txtTelefone.text, _txtPassword.text, base64,
    );

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (message == "") {
      await displayMessage(context, getText('alert_success'), getText('signup_success'));
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => ListCondomiums()));
    } else {
      displayMessage(context, getText('alert_error'), message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('signup_nav_sindico'),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const SizedBox(height: AppSpacing.md),
            GestureDetector(
              onTap: _selectPhoto,
              child: Stack(
                children: [
                  CircleAvatar(
                    radius: 52,
                    backgroundColor: AppColors.primary.withOpacity(0.12),
                    backgroundImage: _getAvatarImage(),
                  ),
                  Positioned(
                    bottom: 0, right: 0,
                    child: Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: AppColors.primary,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.surface(context), width: 2),
                      ),
                      child: const Icon(PhosphorIcons.camera, color: Colors.white, size: 14),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              getText('user_foto_label') != 'user_foto_label' ? getText('user_foto_label') : 'Toque para adicionar foto',
              style: AppTypography.caption(context).copyWith(color: AppColors.textTertiary(context)),
            ),
            const SizedBox(height: AppSpacing.xl),
            AppInput(
              label: getText('user_nome_completo'),
              controller: _txtNome,
              prefixIcon: PhosphorIcons.user,
              textCapitalization: TextCapitalization.words,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('user_documento'),
              controller: _txtDocumento,
              prefixIcon: PhosphorIcons.identificationCard,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: '${getText('data_nascimento')} (Opcional)',
              controller: _txtDN,
              keyboard: TextInputType.number,
              prefixIcon: PhosphorIcons.calendarBlank,
              formatters: [TextInputMask(mask: ['99/99/9999'], reverse: false)],
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('email'),
              controller: _txtEmail,
              keyboard: TextInputType.emailAddress,
              prefixIcon: PhosphorIcons.envelope,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: '${getText('telefone')} (Opcional)',
              controller: _txtTelefone,
              keyboard: TextInputType.phone,
              prefixIcon: PhosphorIcons.phone,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('senha'),
              controller: _txtPassword,
              isPassword: true,
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: getText('btn_enviar'),
              onPressed: _isLoading ? null : _signup,
              loading: _isLoading,
              size: AppButtonSize.lg,
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }
}
