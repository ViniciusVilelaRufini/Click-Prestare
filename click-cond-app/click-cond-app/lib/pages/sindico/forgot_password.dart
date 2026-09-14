import 'package:click/controllers/controller_sindico.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class ForgotPassword extends StatefulWidget {
  final loginType;
  const ForgotPassword({super.key, required this.loginType});

  @override
  _ForgotPasswordState createState() => _ForgotPasswordState();
}

class _ForgotPasswordState extends State<ForgotPassword> {
  final txtEmail = TextEditingController();
  bool _isLoading = false;
  String loginType = "";

  @override
  void initState() {
    super.initState();
    if (widget.loginType == "sindico") { loginType = "sindico"; }
    if (widget.loginType == "morador") { loginType = "moradores"; }
    if (widget.loginType == "funcionario") { loginType = "funcionarios"; }
  }

  @override
  void dispose() {
    txtEmail.dispose();
    super.dispose();
  }

  Future<void> recovery() async {
    final email = txtEmail.text.trim();
    if (email.isEmpty) {
      showAppDialog(
        context,
        title: getText('alert_error'),
        message: getText('email_error') ?? 'Por favor, insira o seu e-mail.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
      return;
    }

    try {
      setState(() => _isLoading = true);
      var msg = await passRecoveryApi(email, loginType);
      if (!mounted) return;
      await showAppDialog(
        context,
        title: getText('alert_success'),
        message: msg ?? 'E-mail de recuperação enviado com sucesso!',
        icon: PhosphorIcons.checkCircle,
        iconColor: AppColors.success,
      );
      if (!mounted) return;
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      showAppDialog(
        context,
        title: getText('alert_error'),
        message: e.toString(),
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: getText('esqueci_senha_nav'),
      showBackButton: true,
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: AppSpacing.xl),
            Center(
              child: Container(
                padding: const EdgeInsets.all(AppSpacing.lg),
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                ),
                child: Icon(
                  PhosphorIcons.lock,
                  size: 36,
                  color: AppColors.primary,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              getText('esqueci_senha_title') ?? 'Esqueceu a senha?',
              style: AppTypography.display(context),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              getText('esqueci_senha_description') ??
                  'Não se preocupe, preencha o seu e-mail abaixo que enviaremos um link de recuperação.',
              style: AppTypography.bodySecondary(context),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxxl),
            AppInput(
              label: getText('email'),
              controller: txtEmail,
              keyboard: TextInputType.emailAddress,
              prefixIcon: PhosphorIcons.envelope,
            ),
            const SizedBox(height: AppSpacing.xxl),
            AppButton(
              label: getText('btn_enviar'),
              loading: _isLoading,
              onPressed: recovery,
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }
}
