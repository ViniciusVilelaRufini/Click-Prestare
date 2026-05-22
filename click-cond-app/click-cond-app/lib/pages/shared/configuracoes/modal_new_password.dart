import 'package:click/controllers/controller_funcionario.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ModalNewPassword extends StatefulWidget {
  const ModalNewPassword({Key? key}) : super(key: key);

  @override
  _ModalNewPasswordState createState() => _ModalNewPasswordState();
}

class _ModalNewPasswordState extends State<ModalNewPassword> {
  final txtNewPassword = TextEditingController();
  final txtConfirmPassword = TextEditingController();
  var _isSaving = false;

  @override
  void initState() {
    super.initState();
    initializeDateFormatting();
  }

  @override
  void dispose() {
    txtNewPassword.dispose();
    txtConfirmPassword.dispose();
    super.dispose();
  }

  Future<void> save() async {
    try {
      setState(() => _isSaving = true);
      if (txtNewPassword.text != txtConfirmPassword.text) {
        throw getText('senhas_nao_conferem');
      }
      if (txtNewPassword.text.length < 6) {
        throw getText('senha_minimo_caracteres');
      }
      if (getUserType() == 'sindico') await updatePasswordSindicoApi(txtNewPassword.text);
      if (getUserType() == 'morador') await updatePasswordMoradorApi(txtNewPassword.text);
      if (getUserType() == 'funcionario') await updatePasswordFuncionarioApi(txtNewPassword.text);
      await displayMessage(context, getText('alert_success'), getText('config_alt_senha_sucesso'));
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) displayMessage(context, getText('alert_error'), e.toString());
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      backgroundColor: AppColors.bg(context),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(getText('config_nova_senha'),
                    style: AppTypography.title(context)),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(PhosphorIcons.x, size: 20),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            AppInput(
              label: getText('config_nova_senha'),
              controller: txtNewPassword,
              prefixIcon: PhosphorIcons.lock,
              isPassword: true,
            ),
            const SizedBox(height: AppSpacing.md),
            AppInput(
              label: getText('config_confirm_nova_senha'),
              controller: txtConfirmPassword,
              prefixIcon: PhosphorIcons.lockKey,
              isPassword: true,
            ),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: getText('btn_save'),
              onPressed: _isSaving ? null : save,
              loading: _isSaving,
              icon: PhosphorIcons.floppyDisk,
            ),
          ],
        ),
      ),
    );
  }
}
