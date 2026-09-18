import 'package:click/pages/shared/aceite_privacidade.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/forgot_password.dart';
import 'package:click/pages/sindico/mfa_verification_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/grid_background.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:click/services/firebase_service.dart';
import '../../controllers/controller_funcionario.dart';
import '../../controllers/controller_moradores.dart';

class LoginSindico extends StatefulWidget {
  const LoginSindico({super.key, required this.loginType});
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
        final res = await loginSindico(login, senha);
        if (res.mfaRequired) {
          if (!mounted) return;
          setState(() => _isLoading = false);
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => MfaVerificationPage(
                mfaToken: res.mfaToken ?? '',
                emailMasked: res.emailMasked ?? '',
                expiresInSeconds: res.expiresInSeconds ?? 600,
              ),
            ),
          );
          return;
        } else if (res.success) {
          message = "";
        } else {
          message = res.errorMessage ?? getText('login_error');
        }
      } else if (widget.loginType == 'morador') {
        message = await loginMorador(login, senha);
      } else {
        message = await loginFuncionario(login, senha);
      }
      if (getUsername().isEmpty && message.isEmpty) message = getText('login_error');
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
        // Passa pela PortaDeEntrada, não direto: é ela que decide entre a
        // tela de aceite de privacidade e o app. Os dois caminhos de entrada
        // (login e auto-login) precisam do mesmo gate.
        MaterialPageRoute(builder: (_) => const PortaDeEntrada()),
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

  IconData _typeIcon() {
    switch (widget.loginType) {
      case 'sindico': return PhosphorIcons.shieldCheckBold;
      case 'morador': return PhosphorIcons.houseFill;
      default: return PhosphorIcons.identificationCard;
    }
  }

  /// A frase que diz ao usuário o que ele encontra depois de entrar — mesma
  /// promessa dos cartões da tela de escolha de perfil.
  String _typeSubtitle() {
    switch (widget.loginType) {
      case 'sindico': return 'Gestão completa do condomínio';
      case 'morador': return 'Visitas, encomendas e reservas';
      default: return 'Portaria, ocorrências e rotinas';
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: Stack(
        children: [
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: isDark
                      ? [const Color(0xFF0A1628), const Color(0xFF04060A)]
                      : [const Color(0xFFFFFFFF), const Color(0xFFEEF4FD)],
                ),
              ),
            ),
          ),
          const Positioned.fill(child: GridBackground()),
          Positioned.fill(
            child: SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.xxl,
                      vertical: AppSpacing.sm,
                    ),
                    child: ConstrainedBox(
                      // Garante altura mínima de tela cheia para o Spacer ter o
                      // que distribuir — é o que gruda o copyright na base
                      // quando sobra espaço, sem quebrar o scroll com teclado.
                      constraints: BoxConstraints(
                        minHeight: constraints.maxHeight - AppSpacing.sm * 2,
                      ),
                      child: IntrinsicHeight(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: _buildBackButton(context),
                            ),
                            const SizedBox(height: AppSpacing.xxl),
                            _buildBrand(context),
                            const SizedBox(height: AppSpacing.xxl),
                            _buildFormCard(context),
                            const Spacer(),
                            const SizedBox(height: AppSpacing.xl),
                            Text(
                              '© 2026 Prestare Gestão e Tecnologia.',
                              style: AppTypography.tiny(context).copyWith(
                                color: AppColors.textTertiary(context),
                              ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: AppSpacing.sm),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBackButton(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.full),
      child: Material(
        color: AppColors.surfaceElevated(context),
        child: InkWell(
          onTap: () => Navigator.pop(context),
          child: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.border(context), width: 1.2),
              shape: BoxShape.circle,
            ),
            child: Icon(
              PhosphorIcons.caretLeft,
              color: AppColors.textPrimary(context),
              size: 20,
            ),
          ),
        ),
      ),
    );
  }

  /// Marca compacta: a mesma logo em cartão branco da tela de entrada, menor,
  /// para o usuário não perder a referência de onde está.
  Widget _buildBrand(BuildContext context) {
    final marca = AppTypography.title(context).copyWith(
      fontSize: 20,
      fontWeight: FontWeight.w800,
      letterSpacing: 0.8,
    );

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.sm),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(
              color: AppColors.primary.withValues(alpha: 0.08),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.16),
                blurRadius: 22,
                spreadRadius: -4,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: Image.asset(
              'assets/images/logo_prestare_gestao.png',
              width: 68,
              height: 68,
              fit: BoxFit.cover,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Flexible(
          child: Text.rich(
            TextSpan(
              children: [
                TextSpan(text: 'PRESTARE ', style: marca),
                TextSpan(
                  text: 'GESTÃO',
                  style: marca.copyWith(color: AppColors.primary),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFormCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(AppRadius.xxl),
        border: Border.all(color: AppColors.border(context), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 24,
            spreadRadius: -6,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Selo do perfil: repete ícone e texto do cartão que trouxe o
          // usuário até aqui, para a navegação não parecer um salto.
          Align(
            alignment: Alignment.centerLeft,
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(AppRadius.full),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_typeIcon(), size: 15, color: AppColors.primary),
                  const SizedBox(width: 6),
                  Text(
                    _typeLabel(),
                    style: AppTypography.tiny(context).copyWith(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text('Entrar', style: AppTypography.title(context)),
          const SizedBox(height: AppSpacing.xs),
          Text(
            _typeSubtitle(),
            style: AppTypography.caption(context),
          ),
          const SizedBox(height: AppSpacing.xl),
          AppInput(
            label: getText('email'),
            controller: _txtLogin,
            keyboard: TextInputType.emailAddress,
            prefixIcon: PhosphorIcons.envelope,
          ),
          const SizedBox(height: AppSpacing.md),
          AppInput(
            label: getText('senha'),
            controller: _txtSenha,
            isPassword: true,
            prefixIcon: PhosphorIcons.lock,
          ),
          const SizedBox(height: AppSpacing.xs),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primary,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: AppSpacing.sm,
                ),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
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
                style: AppTypography.tiny(context).copyWith(
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          AppButton(
            label: getText('login_btn_entrar'),
            loading: _isLoading,
            trailingIcon: PhosphorIcons.arrowRight,
            onPressed: _doLogin,
          ),
        ],
      ),
    );
  }
}
