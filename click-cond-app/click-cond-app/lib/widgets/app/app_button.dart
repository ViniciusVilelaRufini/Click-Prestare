import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

enum AppButtonVariant { primary, secondary, ghost, danger }
enum AppButtonSize { sm, md, lg }

/// Botão padrão do app (`.btn`): sólido `accent` no primário, contorno `line-200`
/// no secundário, sem fundo no ghost. O perigo é só contorno e texto: sinal
/// nunca vira fundo de botão.
class AppButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final IconData? trailingIcon;
  final AppButtonVariant variant;
  final AppButtonSize size;
  final bool fullWidth;
  final bool loading;

  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.trailingIcon,
    this.variant = AppButtonVariant.primary,
    this.size = AppButtonSize.lg,
    this.fullWidth = true,
    this.loading = false,
  });

  double get _height => size == AppButtonSize.sm ? 34 : 48;

  double get _fontSize => size == AppButtonSize.sm ? 11 : 13;

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    final colors = _resolveColors(context, disabled);

    final child = loading
        ? SizedBox(
            height: 18,
            width: 18,
            child: CircularProgressIndicator(strokeWidth: 1.5, color: colors.fg),
          )
        : FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 16, color: colors.fg),
                  const SizedBox(width: 10),
                ],
                Text(
                  label.toUpperCase(),
                  style: AppTypography.button(context).copyWith(
                    color: colors.fg,
                    fontSize: _fontSize,
                    letterSpacing: _fontSize * 0.2,
                  ),
                ),
                if (trailingIcon != null) ...[
                  const SizedBox(width: 10),
                  Icon(trailingIcon, size: 16, color: colors.fg),
                ],
              ],
            ),
          );

    return SizedBox(
      width: fullWidth ? double.infinity : null,
      height: _height,
      child: Material(
        color: colors.bg,
        shape: colors.border != null
            ? RoundedRectangleBorder(side: BorderSide(color: colors.border!))
            : const RoundedRectangleBorder(),
        child: InkWell(
          onTap: disabled ? null : onPressed,
          child: Padding(
            padding: EdgeInsets.symmetric(
              horizontal: size == AppButtonSize.sm ? 14 : AppSpacing.xl,
            ),
            child: Center(child: child),
          ),
        ),
      ),
    );
  }

  _ButtonColors _resolveColors(BuildContext c, bool disabled) {
    if (disabled) {
      return _ButtonColors(
        bg: variant == AppButtonVariant.primary
            ? AppColors.surfaceElevated(c)
            : Colors.transparent,
        fg: AppColors.textTertiary(c),
        border: variant == AppButtonVariant.ghost ? null : AppColors.border(c),
      );
    }
    switch (variant) {
      case AppButtonVariant.primary:
        return _ButtonColors(bg: AppColors.accent(c), fg: AppColors.onAccent(c));
      case AppButtonVariant.secondary:
        return _ButtonColors(
          bg: Colors.transparent,
          fg: AppColors.textPrimary(c),
          border: AppColors.borderStrong(c),
        );
      case AppButtonVariant.ghost:
        return _ButtonColors(
          bg: Colors.transparent,
          fg: AppColors.textPrimary(c),
        );
      case AppButtonVariant.danger:
        return _ButtonColors(
          bg: Colors.transparent,
          fg: AppColors.signalDanger(c),
          border: AppColors.borderStrong(c),
        );
    }
  }
}

class _ButtonColors {
  final Color bg;
  final Color fg;
  final Color? border;
  _ButtonColors({required this.bg, required this.fg, this.border});
}
