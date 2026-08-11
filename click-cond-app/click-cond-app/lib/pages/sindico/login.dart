import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/forgot_password.dart';
import 'package:click/pages/sindico/list_condominiums.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/app_scaffold.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:click/services/firebase_service.dart';
import '../../controllers/controller_funcionario.dart';
import '../../controllers/controller_moradores.dart';

class LoginSindico extends StatefulWidget {
  const LoginSindico({Key? key, required this.loginType}) : super(key: key);
  final String loginType;

  @override
  _LoginSindicoPageState createState() => _LoginSindicoPageState();
}

class _LoginSindicoPageState extends State<LoginSindico> {
  final _txtLogin = TextEditingController();
  final _txtSenha = TextEditingController();
  bool _isLoading = false;

  @override
  void dispose() {
    _txtLogin.dispose();
    _txtSenha.dispose();
    super.dispose();
  }

  Future<void> _doLogin() async {
    if (_isLoading) return;
    final login = _txtLogin.text.trim();
    final senha = _txtSenha.text.trim();
    if (login.isEmpty || senha.isEmpty) {
      showAppDialog(
        context,
        title: getText('alert_error'),
        message: getText('login_error'),
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
      return;
    }

    setState(() => _isLoading = true);

    String message;
    try {
      if (widget.loginType == 'sindico') {
        message = await loginSindico(login, senha);
      } else if (widget.loginType == 'morador') {
        message = await loginMorador(login, senha);
      } else {
        message = await loginFuncionario(login, senha);
      }
      if (getUsername().isEmpty) message = getText('login_error');
    } catch (_) {
      message = getText('login_error');
    }

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (message == "") {
      await _updateFcmToken();
      if (!mounted) return;
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const ListCondomiums()),
      );
    } else {
      showAppDialog(
        context,
        title: getText('alert_error'),
        message: message,
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
    }
  }

  // Um único caminho de registro, no FirebaseService — que também registra na
  // abertura do app e quando o FCM troca o token. Aqui continua sendo
  // necessário porque no primeiro login ainda não havia JWT quando o serviço
  // subiu.
  Future<void> _updateFcmToken() => FirebaseService.instance.registrarNoServidor();

  String _typeLabel() {
    switch (widget.loginType) {
      case 'sindico': return getText('sindico');
      case 'morador': return getText('morador');
      default: return getText('funcionario');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
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
                  widget.loginType == 'sindico'
                      ? PhosphorIcons.userCircleFill
                      : widget.loginType == 'morador'
                          ? PhosphorIcons.houseFill
                          : PhosphorIcons.briefcaseFill,
                  size: 36,
                  color: AppColors.primary,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              'Entrar',
              style: AppTypography.display(context),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Acessar como ${_typeLabel()}',
              style: AppTypography.bodySecondary(context),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xxxl),
            AppInput(
              label: getText('email'),
              controller: _txtLogin,
              keyboard: TextInputType.emailAddress,
              prefixIcon: PhosphorIcons.envelope,
            ),
            const SizedBox(height: AppSpacing.lg),
            AppInput(
              label: getText('senha'),
              controller: _txtSenha,
              isPassword: true,
              prefixIcon: PhosphorIcons.lock,
            ),
            const SizedBox(height: AppSpacing.md),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.sm,
                    vertical: AppSpacing.sm,
                  ),
                ),
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => ForgotPassword(loginType: widget.loginType),
                    ),
                  );
                },
                child: Text(
                  getText('login_btn_esqueci_senha'),
                  style: AppTypography.captionMedium(context).copyWith(
                    color: AppColors.primary,
                  ),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: getText('login_btn_entrar'),
              loading: _isLoading,
              onPressed: _doLogin,
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }
}
