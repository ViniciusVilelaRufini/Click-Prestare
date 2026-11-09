import 'dart:async';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:click/widgets/app/prestare_logo.dart';
import 'package:click/controllers/controller_sindico.dart';
import 'package:click/pages/sindico/recuperar_senha_nova_senha_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_dialog.dart';

class RecuperarSenhaCodigoPage extends StatefulWidget {
  final String ticketId;
  final String emailMasked;
  final String loginType;
  final String email;
  final int expiresInSeconds;

  const RecuperarSenhaCodigoPage({
    super.key,
    required this.ticketId,
    required this.emailMasked,
    required this.loginType,
    required this.email,
    this.expiresInSeconds = 600,
  });

  @override
  State<RecuperarSenhaCodigoPage> createState() => _RecuperarSenhaCodigoPageState();
}

class _RecuperarSenhaCodigoPageState extends State<RecuperarSenhaCodigoPage> {
  late String _currentTicketId;
  late String _currentEmailMasked;
  late int _remainingSeconds;
  Timer? _countdownTimer;

  int _resendCooldown = 60;
  Timer? _cooldownTimer;

  bool _isLoading = false;
  bool _isResending = false;

  final TextEditingController _codeController = TextEditingController();
  final FocusNode _codeFocusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _currentTicketId = widget.ticketId;
    _currentEmailMasked = widget.emailMasked;
    _remainingSeconds = widget.expiresInSeconds;

    _codeController.addListener(() {
      if (mounted) setState(() {});
      if (_codeController.text.length == 6 && !_isLoading) {
        _validarCodigo();
      }
    });

    _startCountdownTimer();
    _startCooldownTimer();

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

  IconData _typeIcon() {
    switch (widget.loginType) {
      case 'morador':
        return PhosphorIcons.house;
      case 'funcionario':
        return PhosphorIcons.identificationCard;
      default:
        return PhosphorIcons.buildings;
    }
  }

  String _typeLabel() {
    switch (widget.loginType) {
      case 'morador':
        return 'Morador';
      case 'funcionario':
        return 'Funcionário';
      default:
        return 'Síndico';
    }
  }

  Future<void> _validarCodigo() async {
    final code = _codeController.text.trim();
    if (code.length != 6) {
      showAppDialog(
        context,
        title: 'Código incompleto',
        message: 'Por favor, preencha os 6 dígitos do código recebido por e-mail.',
        icon: PhosphorIcons.warning,
        iconColor: AppColors.warning,
      );
      return;
    }

    if (_remainingSeconds <= 0) {
      showAppDialog(
        context,
        title: 'Código expirado',
        message: 'O tempo limite deste código expirou. Por favor, solicite o reenvio de um novo código.',
        icon: PhosphorIcons.clockClockwise,
        iconColor: AppColors.warning,
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final resetToken = await validarCodigoRedefinicaoApi(
        _currentTicketId,
        code,
        loginType: widget.loginType,
      );

      if (!mounted) return;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => RecuperarSenhaNovaSenhaPage(
            resetToken: resetToken,
            loginType: widget.loginType,
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      showAppDialog(
        context,
        title: 'Validação de Código',
        message: e.toString(),
        icon: PhosphorIcons.shieldWarning,
        iconColor: AppColors.error,
      );
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _handleResend() async {
    if (_resendCooldown > 0 || _isResending) return;

    setState(() => _isResending = true);

    try {
      final res = await solicitarCodigoRedefinicaoApi(
        widget.email,
        widget.loginType,
      );

      if (!mounted) return;

      setState(() {
        _isResending = false;
        _currentTicketId = res['ticket_id']?.toString() ?? _currentTicketId;
        _currentEmailMasked = res['email_masked']?.toString() ?? _currentEmailMasked;
        _remainingSeconds = res['expira_em_segundos'] ?? 600;
        _resendCooldown = 60;
        _codeController.clear();
      });

      _startCountdownTimer();
      _startCooldownTimer();

      showAppDialog(
        context,
        title: 'Código reenviado',
        message: 'Um novo código de 6 dígitos foi enviado para o seu e-mail.',
        icon: PhosphorIcons.checkCircle,
        iconColor: AppColors.success,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _isResending = false);
      showAppDialog(
        context,
        title: 'Erro ao reenviar',
        message: e.toString(),
        icon: PhosphorIcons.warning,
        iconColor: AppColors.error,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isExpired = _remainingSeconds <= 0;

    return Scaffold(
      backgroundColor: AppColors.bg(context),
      body: Stack(
        children: [
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
                            _buildFormCard(context, isExpired),
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
    // `.iconbtn`: quadrado de 40px com contorno line-100.
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

  Widget _buildBrand(BuildContext context) {
    final tinta = AppColors.textPrimary(context);
    return Row(
      children: [
        PrestareLogo(height: 48, color: tinta),
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
              height: 1,
              fontWeight: FontWeight.w600,
              letterSpacing: 28 * 0.06,
              color: tinta,
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildFormCard(BuildContext context, bool isExpired) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(AppRadius.xxl),
        border: Border.all(color: AppColors.border(context), width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Container(
              height: 22,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.borderStrong(context)),
                borderRadius: BorderRadius.circular(AppRadius.tag),
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
            'Código de Segurança'.toUpperCase(),
            style: AppTypography.title(context),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text.rich(
            TextSpan(
              style: AppTypography.caption(context).copyWith(
                fontSize: 13,
                height: 1.4,
              ),
              children: [
                const TextSpan(text: 'Digite o código de 6 dígitos enviado para:\n'),
                TextSpan(
                  text: _currentEmailMasked,
                  style: TextStyle(
                    color: AppColors.textPrimary(context),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
          _buildOtpRow(context),
          const SizedBox(height: AppSpacing.lg),
          Center(
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.xs + 2,
              ),
              decoration: BoxDecoration(
                color: (isExpired ? AppColors.error : AppColors.primary)
                    .withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppRadius.tag),
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
          AppButton(
            label: 'VALIDAR CÓDIGO',
            loading: _isLoading,
            trailingIcon: PhosphorIcons.arrowRight,
            onPressed: _validarCodigo,
          ),
          const SizedBox(height: AppSpacing.md),
          Center(
            child: TextButton(
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
                  _validarCodigo();
                } else {
                  _codeFocusNode.unfocus();
                }
              },
            ),
          ),
        ),
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
