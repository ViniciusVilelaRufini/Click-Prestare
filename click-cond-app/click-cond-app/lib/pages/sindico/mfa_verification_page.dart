import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/shared/aceite_privacidade.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';
import 'package:click/widgets/app/grid_background.dart';

class MfaVerificationPage extends StatefulWidget {
  final String mfaToken;
  final String emailMasked;
  final int expiresInSeconds;

  const MfaVerificationPage({
    super.key,
    required this.mfaToken,
    required this.emailMasked,
    this.expiresInSeconds = 600,
  });

  @override
  State<MfaVerificationPage> createState() => _MfaVerificationPageState();
}

class _MfaVerificationPageState extends State<MfaVerificationPage> {
  late String _currentMfaToken;
  late String _currentEmailMasked;
  late int _remainingSeconds;
  Timer? _countdownTimer;

  int _resendCooldown = 60;
  Timer? _cooldownTimer;

  bool _rememberDevice = true;
  bool _isLoading = false;
  bool _isResending = false;

  final TextEditingController _codeController = TextEditingController();
  final FocusNode _codeFocusNode = FocusNode();
  final ScrollController _pageScrollController = ScrollController();
  final GlobalKey _confirmButtonKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _currentMfaToken = widget.mfaToken;
    _currentEmailMasked = widget.emailMasked;
    _remainingSeconds = widget.expiresInSeconds;

    _codeController.addListener(() {
      if (mounted) setState(() {});
      if (_codeController.text.length == 6 && !_isLoading) {
        _submitVerification();
      }
    });

    _codeFocusNode.addListener(() {
      if (mounted) setState(() {});
      if (_codeFocusNode.hasFocus) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_pageScrollController.hasClients) {
            _pageScrollController.animateTo(
              _pageScrollController.position.maxScrollExtent,
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOut,
            );
          }
        });
      }
    });

    _startCountdownTimer();
    _startCooldownTimer();

    // Auto-foco suave na entrada
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _codeFocusNode.requestFocus();
      }
    });
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _cooldownTimer?.cancel();
    _codeController.dispose();
    _codeFocusNode.dispose();
    _pageScrollController.dispose();
    super.dispose();
  }

  void _startCountdownTimer() {
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      if (_remainingSeconds > 0) {
        setState(() => _remainingSeconds--);
      } else {
        timer.cancel();
      }
    });
  }

  void _startCooldownTimer() {
    _cooldownTimer?.cancel();
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      if (_resendCooldown > 0) {
        setState(() => _resendCooldown--);
      } else {
        timer.cancel();
      }
    });
  }

  String _formatTime(int totalSeconds) {
    if (totalSeconds <= 0) return '00:00';
    final minutes = (totalSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (totalSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  String get _code => _codeController.text.trim();

  Future<void> _submitVerification() async {
    _codeFocusNode.unfocus();
    final code = _code;
    if (code.length != 6) {
      showAppDialog(
        context,
        title: 'Código incompleto',
        message: 'Digite os 6 dígitos do código recebido por e-mail.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.warning,
      );
      return;
    }

    if (_remainingSeconds <= 0) {
      showAppDialog(
        context,
        title: 'Código expirado',
        message: 'O tempo limite deste código expirou. Por favor, clique em "Reenviar código".',
        icon: PhosphorIcons.clockClockwise,
        iconColor: AppColors.warning,
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final error = await verifyMfaCode(_currentMfaToken, code, _rememberDevice);
      if (!mounted) return;

      if (error.isEmpty) {
        // Sucesso na validação 2FA
        try {
          await FirebaseService.instance.registrarNoServidor();
        } catch (_) {}

        if (!mounted) return;
        Navigator.pushAndRemoveUntil(
          context,
          MaterialPageRoute(builder: (_) => const PortaDeEntrada()),
          (route) => false,
        );
      } else {
        setState(() => _isLoading = false);
        showAppDialog(
          context,
          title: 'Não foi possível entrar',
          message: error,
          icon: PhosphorIcons.shieldWarning,
          iconColor: AppColors.error,
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      showAppDialog(
        context,
        title: 'Erro de conexão',
        message: 'Não foi possível verificar o código. Verifique sua conexão e tente novamente.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
    }
  }

  Future<void> _handleResend() async {
    if (_resendCooldown > 0 || _isResending) return;

    setState(() => _isResending = true);

    try {
      final res = await resendMfaCode(_currentMfaToken);
      if (!mounted) return;

      setState(() => _isResending = false);

      if (res['success'] == true) {
        setState(() {
          _currentMfaToken = res['mfa_token']?.toString() ?? _currentMfaToken;
          if (res['email_masked'] != null) {
            _currentEmailMasked = res['email_masked'].toString();
          }
          _remainingSeconds = res['expires_in_seconds'] is int
              ? res['expires_in_seconds'] as int
              : 600;
          _resendCooldown = 60;
          _codeController.clear();
        });
        _startCountdownTimer();
        _startCooldownTimer();
        _codeFocusNode.requestFocus();

        showAppDialog(
          context,
          title: 'Código reenviado',
          message: 'Um novo código de 6 dígitos foi enviado para $_currentEmailMasked.',
          icon: PhosphorIcons.paperPlaneTilt,
          iconColor: AppColors.success,
        );
      } else {
        showAppDialog(
          context,
          title: 'Atenção',
          message: res['message']?.toString() ?? 'Não foi possível reenviar o código agora.',
          icon: PhosphorIcons.warning,
          iconColor: AppColors.warning,
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _isResending = false);
      showAppDialog(
        context,
        title: 'Erro ao reenviar',
        message: 'Houve uma falha ao solicitar o reenvio. Tente novamente em instantes.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
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
              child: GestureDetector(
                onTap: () => FocusScope.of(context).unfocus(),
                behavior: HitTestBehavior.translucent,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final tecladoAberto = MediaQuery.viewInsetsOf(context).bottom > 0;
                    if (tecladoAberto) {
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        final confirmContext = _confirmButtonKey.currentContext;
                        if (confirmContext != null) {
                          Scrollable.ensureVisible(
                            confirmContext,
                            duration: const Duration(milliseconds: 220),
                            curve: Curves.easeOut,
                            alignment: 0.9,
                          );
                        }
                      });
                    }
                    return AnimatedPadding(
                      duration: const Duration(milliseconds: 180),
                      curve: Curves.easeOut,
                      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
                      child: SingleChildScrollView(
                      controller: _pageScrollController,
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: EdgeInsets.symmetric(
                        horizontal: AppSpacing.xxl,
                        vertical: tecladoAberto ? AppSpacing.xs : AppSpacing.sm,
                      ),
                      child: ConstrainedBox(
                        constraints: tecladoAberto
                            ? const BoxConstraints()
                            : BoxConstraints(minHeight: constraints.maxHeight - AppSpacing.sm * 2),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Align(
                              alignment: Alignment.centerLeft,
                              child: _buildBackButton(context),
                            ),
                            SizedBox(height: tecladoAberto ? AppSpacing.sm : AppSpacing.xl),
                            _buildHeader(context),
                            SizedBox(height: tecladoAberto ? AppSpacing.lg : AppSpacing.xxl),
                            _buildVerificationCard(context),
                            if (!tecladoAberto) ...[
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
                          ],
                        ),
                      ),
                    ),
                    );
                  },
                ),
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

  Widget _buildHeader(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 72,
          height: 72,
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.12),
            shape: BoxShape.circle,
            border: Border.all(
              color: AppColors.primary.withValues(alpha: 0.25),
              width: 2,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.18),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: const Center(
            child: Icon(
              PhosphorIcons.shieldCheckBold,
              color: AppColors.primary,
              size: 36,
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Autenticação em 2 Etapas',
          style: AppTypography.title(context).copyWith(
            fontWeight: FontWeight.w800,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AppSpacing.sm),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          child: Text.rich(
            TextSpan(
              style: AppTypography.caption(context).copyWith(
                fontSize: 14,
                height: 1.4,
              ),
              children: [
                const TextSpan(text: 'Enviamos um código de segurança de 6 dígitos para o e-mail cadastrado:\n'),
                TextSpan(
                  text: _currentEmailMasked,
                  style: TextStyle(
                    color: AppColors.textPrimary(context),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            textAlign: TextAlign.center,
          ),
        ),
      ],
    );
  }

  Widget _buildVerificationCard(BuildContext context) {
    final isExpired = _remainingSeconds <= 0;

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
          LayoutBuilder(builder: (context, constraints) => Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Text(
                  'Digite o código recebido',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.headline(context).copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              if (_codeFocusNode.hasFocus)
                TextButton.icon(
                  onPressed: () => _codeFocusNode.unfocus(),
                  icon: const Icon(PhosphorIcons.caretDown, size: 14),
                  label: constraints.maxWidth < 310 ? const SizedBox.shrink() : const Text('Ocultar teclado', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.textSecondary(context),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    visualDensity: VisualDensity.compact,
                    backgroundColor: AppColors.surface(context),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppRadius.full),
                      side: BorderSide(color: AppColors.border(context)),
                    ),
                  ),
                ),
            ],
          )),
          const SizedBox(height: AppSpacing.xl),
          _buildOtpRow(context),
          const SizedBox(height: AppSpacing.lg),
          // Timer e status
          Center(
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.xs + 2,
              ),
              decoration: BoxDecoration(
                color: (isExpired ? AppColors.error : AppColors.primary)
                    .withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppRadius.full),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    isExpired ? PhosphorIcons.clock : PhosphorIcons.timer,
                    size: 16,
                    color: isExpired ? AppColors.error : AppColors.primary,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    isExpired
                        ? 'Código expirado'
                        : 'Expira em ${_formatTime(_remainingSeconds)}',
                    style: AppTypography.tiny(context).copyWith(
                      color: isExpired ? AppColors.error : AppColors.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          // Checkbox Lembrar deste aparelho por 30 dias
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.surface(context),
              borderRadius: BorderRadius.circular(AppRadius.lg),
              border: Border.all(
                color: _rememberDevice
                    ? AppColors.primary.withValues(alpha: 0.3)
                    : AppColors.border(context),
              ),
            ),
            child: InkWell(
              onTap: () => setState(() => _rememberDevice = !_rememberDevice),
              borderRadius: BorderRadius.circular(AppRadius.lg),
              child: Row(
                children: [
                  Checkbox(
                    value: _rememberDevice,
                    activeColor: AppColors.primary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(4),
                    ),
                    onChanged: (val) => setState(() => _rememberDevice = val ?? false),
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Lembrar deste aparelho por 30 dias',
                          style: AppTypography.body(context).copyWith(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Não pedir código novamente neste dispositivo.',
                          style: AppTypography.tiny(context).copyWith(
                            color: AppColors.textTertiary(context),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          SizedBox(
            key: _confirmButtonKey,
            child: AppButton(
              label: 'Confirmar e Entrar',
              loading: _isLoading,
              trailingIcon: PhosphorIcons.arrowRight,
              onPressed: _submitVerification,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextButton(
            onPressed: (_resendCooldown > 0 || _isResending) ? null : _handleResend,
            style: TextButton.styleFrom(
              foregroundColor: AppColors.primary,
              disabledForegroundColor: AppColors.textTertiary(context),
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            ),
            child: _isResending
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(
                    _resendCooldown > 0
                        ? 'Reenviar código em ${_resendCooldown}s'
                        : 'Não recebeu? Reenviar código',
                    style: AppTypography.bodySecondary(context).copyWith(
                      color: _resendCooldown > 0
                          ? AppColors.textTertiary(context)
                          : AppColors.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildOtpRow(BuildContext context) {
    final currentCode = _codeController.text;

    return Stack(
      alignment: Alignment.center,
      children: [
        // 1. TextField real invisível mas totalmente interativo, com input numérico estável no iOS
        Opacity(
          opacity: 0.0,
          child: SizedBox(
            width: double.infinity,
            height: 60,
            child: TextField(
              controller: _codeController,
              focusNode: _codeFocusNode,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              enableSuggestions: false,
              autocorrect: false,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              onSubmitted: (_) {
                if (_codeController.text.trim().length == 6) {
                  _submitVerification();
                } else {
                  _codeFocusNode.unfocus();
                }
              },
            ),
          ),
        ),

        // 2. Os 6 quadrantes visuais desenhados com alta elegância e precisão
        IgnorePointer(
          child: Row(
            children: List.generate(6, (index) {
              final hasChar = currentCode.length > index;
              final char = hasChar ? currentCode[index] : '';
              final isCurrentSlot = _codeFocusNode.hasFocus &&
                  (currentCode.length == index ||
                      (currentCode.length == 6 && index == 5));

              return Expanded(
                child: Container(
                  height: 58,
                  margin: EdgeInsets.only(
                    left: index == 0 ? 0 : AppSpacing.xs,
                    right: index == 5 ? 0 : AppSpacing.xs,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface(context),
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(
                      color: isCurrentSlot
                          ? AppColors.primary
                          : (hasChar
                              ? AppColors.primary.withValues(alpha: 0.6)
                              : AppColors.border(context)),
                      width: isCurrentSlot ? 2.2 : (hasChar ? 1.5 : 1.2),
                    ),
                    boxShadow: isCurrentSlot
                        ? [
                            BoxShadow(
                              color: AppColors.primary.withValues(alpha: 0.2),
                              blurRadius: 8,
                              spreadRadius: 1,
                            ),
                          ]
                        : null,
                  ),
                  child: Center(
                    child: Text(
                      char,
                      style: AppTypography.title(context).copyWith(
                        fontWeight: FontWeight.w800,
                        fontSize: 24,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
      ],
    );
  }
}
