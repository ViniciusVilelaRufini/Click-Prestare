import 'dart:math' as math;
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Componente que envolve qualquer campo/área de formulário e adiciona:
/// 1. Animação de Shake (vibração horizontal elástica)
/// 2. Brilho/Glow pulsante na cor de erro (AppColors.error)
/// 3. Mensagem e ícone de alerta animados logo abaixo do campo
/// 4. Facilidade de auto-scroll suave para chamar a atenção do usuário
class ValidationAlertWrapper extends StatefulWidget {
  final Widget child;
  final String? errorText;
  final GlobalKey? scrollKey;
  final bool animateOnChange;
  final BorderRadius? borderRadius;

  const ValidationAlertWrapper({
    super.key,
    required this.child,
    this.errorText,
    this.scrollKey,
    this.animateOnChange = true,
    this.borderRadius,
  });

  /// Utilitário estático para rolar suavemente a tela até o campo com erro
  static void scrollTo(GlobalKey? key, {double alignment = 0.2}) {
    final ctx = key?.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(
        ctx,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeInOutCubic,
        alignment: alignment,
      );
    }
  }

  /// Utilitário estático para exibir SnackBar flutuante moderna sem bloquear a tela
  static void showErrorSnackBar(BuildContext context, String message) {
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(PhosphorIcons.warningCircle, color: Colors.white, size: 20),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.rmd),
        margin: const EdgeInsets.all(AppSpacing.md),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  @override
  State<ValidationAlertWrapper> createState() => _ValidationAlertWrapperState();
}

class _ValidationAlertWrapperState extends State<ValidationAlertWrapper>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _shakeAnimation;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    );

    _shakeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );

    _pulseAnimation = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutQuad),
    );

    if (widget.errorText != null && widget.errorText!.trim().isNotEmpty) {
      _controller.forward(from: 0.0);
    }
  }

  @override
  void didUpdateWidget(ValidationAlertWrapper oldWidget) {
    super.didUpdateWidget(oldWidget);
    final hasNewError =
        widget.errorText != null && widget.errorText!.trim().isNotEmpty;
    final hadError =
        oldWidget.errorText != null && oldWidget.errorText!.trim().isNotEmpty;

    if (hasNewError &&
        (widget.animateOnChange || !hadError || widget.errorText != oldWidget.errorText)) {
      _controller.forward(from: 0.0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  double _calculateShake(double t) {
    if (t == 0.0 || t == 1.0) return 0.0;
    // Micro-vibração suave, sutil e elegante (amplitude reduzida para 3.5px)
    return math.sin(t * math.pi * 5.0) * 3.5 * (1.0 - t);
  }

  @override
  Widget build(BuildContext context) {
    final hasError =
        widget.errorText != null && widget.errorText!.trim().isNotEmpty;

    return Container(
      key: widget.scrollKey,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          final shakeOffset = _calculateShake(_shakeAnimation.value);

          return Transform.translate(
            offset: Offset(shakeOffset, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                widget.child,
                AnimatedSize(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeInOut,
                  child: hasError
                      ? Padding(
                          padding: const EdgeInsets.only(
                            top: AppSpacing.xs,
                            left: AppSpacing.md,
                            right: AppSpacing.md,
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Icon(
                                PhosphorIcons.warningCircle,
                                size: 12,
                                color: AppColors.error.withValues(alpha: 0.75),
                              ),
                              const SizedBox(width: 5),
                              Expanded(
                                child: Text(
                                  widget.errorText!,
                                  style: AppTypography.tiny(context).copyWith(
                                    color: AppColors.error.withValues(alpha: 0.85),
                                    fontWeight: FontWeight.w400,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        )
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
