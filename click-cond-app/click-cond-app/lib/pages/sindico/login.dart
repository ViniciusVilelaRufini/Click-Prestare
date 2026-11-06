import 'package:click/pages/shared/aceite_privacidade.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/forgot_password.dart';
import 'package:click/pages/sindico/mfa_verification_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/app_input.dart';
import 'package:click/widgets/app/powered_by_aws.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'package:click/services/firebase_service.dart';
import 'package:click/services/biometric_auth_service.dart';
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

  bool _hasBiometrics = false;
  bool _hasSavedCredentials = false;
  bool _isBiometricAuthenticating = false;
  bool _autoBiometricAttempted = false;
  String _biometricLabel = 'Face ID';

  @override
  void initState() {
    super.initState();
    _checkBiometrics();
  }

  Future<void> _checkBiometrics() async {
    final service = BiometricAuthService.instance;
    final available = await service.isBiometricAvailable();
    if (!available || !mounted) return;

    final label = await service.getBiometricLabel();
    final creds = await service.getSavedCredentials(widget.loginType);

    if (!mounted) return;
    setState(() {
      _hasBiometrics = available;
      _biometricLabel = label;
      if (creds != null) {
        _hasSavedCredentials = true;
        _txtLogin.text = creds['login'] ?? '';
      }
    });

    if (creds != null && !_autoBiometricAttempted) {
      _autoBiometricAttempted = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _loginWithBiometrics(creds: creds);
        }
      });
    }
  }

  Future<void> _loginWithBiometrics({Map<String, String>? creds}) async {
    if (_isLoading || _isBiometricAuthenticating) return;

    final service = BiometricAuthService.instance;
    final saved = creds ?? await service.getSavedCredentials(widget.loginType);
    if (saved == null) return;

    setState(() => _isBiometricAuthenticating = true);

    final authenticated = await service.authenticate(
      reason:
          'Autentique-se com $_biometricLabel para acessar sua conta de ${_typeLabel()}',
    );

    if (!mounted) return;
    setState(() => _isBiometricAuthenticating = false);

    if (authenticated) {
      _txtLogin.text = saved['login'] ?? '';
      _txtSenha.text = saved['password'] ?? '';
      await _doLogin(isFromBiometrics: true);
    }
  }

  Future<void> _forgetBiometrics() async {
    final confirm = await showAppConfirmDialog(
      context,
      title: 'Desvincular $_biometricLabel?',
      message:
          'Suas credenciais salvas de ${_typeLabel()} serão removidas deste dispositivo.',
      confirmLabel: 'Desvincular',
      cancelLabel: 'Cancelar',
      isDanger: true,
    );
    if (confirm == true) {
      await BiometricAuthService.instance.clearCredentials(widget.loginType);
      if (!mounted) return;
      setState(() {
        _hasSavedCredentials = false;
        _txtSenha.clear();
      });
    }
  }

  @override
  void dispose() {
    _txtLogin.dispose();
    _txtSenha.dispose();
    super.dispose();
  }

  Future<void> _doLogin({bool isFromBiometrics = false}) async {
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
      if (!isFromBiometrics && _hasBiometrics) {
        final service = BiometricAuthService.instance;
        final isSaved = await service.hasSavedCredentials(widget.loginType);
        if (!isSaved && mounted) {
          final shouldSave = await showAppConfirmDialog(
            context,
            title: 'Ativar $_biometricLabel?',
            message:
                'Deseja salvar sua senha no aparelho e usar o $_biometricLabel para entrar com rapidez e segurança nos próximos acessos?',
            confirmLabel: 'Ativar $_biometricLabel',
            cancelLabel: 'Agora não',
            icon: PhosphorIcons.scan,
            iconColor: AppColors.primary,
          );
          if (shouldSave == true) {
            await service.saveCredentials(
              loginType: widget.loginType,
              login: login,
              password: senha,
            );
          }
        } else if (isSaved) {
          // Se já possuía Face ID salvo e digitou credenciais alteradas, atualiza
          // o Keychain para manter a biometria sempre sincronizada com a senha nova.
          await service.updateCredentialsIfChanged(
            loginType: widget.loginType,
            login: login,
            password: senha,
          );
        }
      }

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
      case 'sindico': return PhosphorIcons.shieldCheck;
      case 'morador': return PhosphorIcons.house;
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
    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              child: ConstrainedBox(
                // Altura mínima de tela cheia para o Spacer ter o que
                // distribuir: gruda o copyright na base quando sobra espaço,
                // sem quebrar o scroll com o teclado aberto.
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight - 24,
                ),
                child: IntrinsicHeight(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SizedBox(
                        height: 56,
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: _buildBackButton(context),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      _buildBrand(context),
                      const SizedBox(height: 32),
                      _buildFormCard(context),
                      const Spacer(),
                      const SizedBox(height: AppSpacing.xl),
                      Text(
                        '© 2026 Prestare Gestão e Tecnologia.',
                        style: GoogleFonts.barlow(
                          fontSize: 12,
                          height: 16 / 12,
                          color: AppColors.textTertiary(context),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  /// `.label`: Barlow Condensed 11/14, +0.2em, maiúsculas.
  TextStyle _rotulo(BuildContext context, {Color? color}) {
    return GoogleFonts.barlowCondensed(
      fontSize: 11,
      height: 14 / 11,
      fontWeight: FontWeight.w600,
      letterSpacing: 11 * 0.2,
      color: color ?? AppColors.textTertiary(context),
    );
  }

  /// `.iconbtn`: quadrado de 40px com contorno line-100.
  Widget _buildBackButton(BuildContext context) {
    return InkWell(
      onTap: () => Navigator.pop(context),
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border(context)),
        ),
        child: Icon(
          PhosphorIcons.caretLeft,
          color: AppColors.textPrimary(context),
          size: 18,
        ),
      ),
    );
  }

  /// Marca compacta: logo monocromática e o nome em Barlow Condensed, para o
  /// usuário não perder a referência de onde está.
  Widget _buildBrand(BuildContext context) {
    final tinta = AppColors.textPrimary(context);
    return Row(
      children: [
        Image.asset(
          'assets/images/logo_prestare_mono.png',
          height: 48,
          color: tinta,
          colorBlendMode: BlendMode.srcIn,
          fit: BoxFit.contain,
        ),
        const SizedBox(width: AppSpacing.lg),
        Flexible(
          child: Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: 'PRESTARE\n'),
                TextSpan(
                  text: 'GESTÃO',
                  style: TextStyle(fontWeight: FontWeight.w300, color: tinta),
                ),
              ],
            ),
            style: GoogleFonts.barlowCondensed(
              fontSize: 28,
              height: 28 / 28,
              fontWeight: FontWeight.w600,
              letterSpacing: 28 * 0.06,
              color: tinta,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        const Flexible(child: PoweredByAws(height: 18)),
      ],
    );
  }

  Widget _buildFormCard(BuildContext context) {
    final cinza = AppColors.textTertiary(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Selo do perfil (`.tag`): repete ícone e texto do item que trouxe o
        // usuário até aqui, para a navegação não parecer um salto.
        Align(
          alignment: Alignment.centerLeft,
          child: Container(
            height: 22,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.borderStrong(context)),
              borderRadius: BorderRadius.circular(2),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(_typeIcon(),
                    size: 13, color: AppColors.textSecondary(context)),
                const SizedBox(width: 6),
                Text(
                  _typeLabel().toUpperCase(),
                  style: GoogleFonts.barlowCondensed(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 10 * 0.18,
                    color: AppColors.textSecondary(context),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'ENTRAR',
          style: GoogleFonts.barlowCondensed(
            fontSize: 22,
            height: 26 / 22,
            fontWeight: FontWeight.w600,
            letterSpacing: 22 * 0.1,
            color: AppColors.textPrimary(context),
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          _typeSubtitle(),
          style: GoogleFonts.barlow(
            fontSize: 14,
            height: 20 / 14,
            color: AppColors.textSecondary(context),
          ),
        ),
        const SizedBox(height: AppSpacing.xxl),
        if (_hasSavedCredentials) ...[
          AppButton(
            label: 'Entrar com $_biometricLabel',
            icon: PhosphorIcons.scan,
            loading: _isBiometricAuthenticating,
            variant: AppButtonVariant.primary,
            onPressed: () => _loginWithBiometrics(),
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(child: Divider(color: AppColors.border(context))),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                child: Text(
                  'ou acesse com sua senha'.toUpperCase(),
                  style: _rotulo(context, color: cinza),
                ),
              ),
              Expanded(child: Divider(color: AppColors.border(context))),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
        ],
        AppInput(
          label: widget.loginType == 'morador'
              ? 'CPF ou E-mail'
              : widget.loginType == 'funcionario'
                  ? 'Usuário ou E-mail'
                  : getText('email'),
          controller: _txtLogin,
          keyboard: widget.loginType == 'morador'
              ? TextInputType.text
              : TextInputType.emailAddress,
          prefixIcon: widget.loginType == 'morador'
              ? PhosphorIcons.identificationCard
              : PhosphorIcons.envelope,
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
              foregroundColor: AppColors.textPrimary(context),
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
              style: GoogleFonts.barlow(
                fontSize: 12,
                height: 16 / 12,
                fontWeight: FontWeight.w500,
                color: AppColors.textPrimary(context),
                decoration: TextDecoration.underline,
                decorationColor: AppColors.borderStrong(context),
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
        if (_hasSavedCredentials) ...[
          const SizedBox(height: AppSpacing.md),
          Center(
            child: TextButton.icon(
              style: TextButton.styleFrom(
                foregroundColor: cinza,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.sm,
                  vertical: AppSpacing.xs,
                ),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              icon: const Icon(PhosphorIcons.trash, size: 14),
              label: Text(
                'Desvincular $_biometricLabel deste aparelho',
                style: GoogleFonts.barlow(
                  fontSize: 12,
                  height: 16 / 12,
                  color: cinza,
                ),
              ),
              onPressed: _forgetBiometrics,
            ),
          ),
        ],
      ],
    );
  }
}
