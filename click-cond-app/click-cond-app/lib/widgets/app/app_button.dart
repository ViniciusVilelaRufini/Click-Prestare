import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

enum AppButtonVariant { primary, secondary, ghost, danger }
enum AppButtonSize { sm, md, lg }

/// Botão padrão do app, com 4 variantes (primary, secondary, ghost, danger)
/// e 3 tamanhos (sm, md, lg).
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
    Key? key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.trailingIcon,
    this.variant = AppButtonVariant.primary,
    this.size = AppButtonSize.lg,
    this.fullWidth = true,
    this.loading = false,
  }) : super(key: key);

  double get _height {
    switch (size) {
      case AppButtonSize.sm: return 40;
      case AppButtonSize.md: return 48;
      case AppButtonSize.lg: return 56;
    }
  }

  double get _fontSize {
    switch (size) {
      case AppButtonSize.sm: return 14;
      case AppButtonSize.md: return 15;
      case AppButtonSize.lg: return 16;
    }
  }

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    final colors = _resolveColors(context, disabled);

    final child = loading
        ? SizedBox(
            height: 22, width: 22,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: colors.fg),
          )
        : FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 20, color: colors.fg),
                  const SizedBox(width: 8),
                ],
                Text(label, style: AppTypography.button(context).copyWith(
                  color: colors.fg, fontSize: _fontSize,
                )),
                if (trailingIcon != null) ...[
                  const SizedBox(width: 8),
                  Icon(trailingIcon, size: 20, color: colors.fg),
                ],
              ],
            ),
          );

    return SizedBox(
      width: fullWidth ? double.infinity : null,
      height: _height,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          color: colors.bg,
          borderRadius: AppRadius.rlg,
          border: colors.border != null
              ? Border.all(color: colors.border!, width: 1.5)
              : null,
          boxShadow: variant == AppButtonVariant.primary && !disabled
              ? [BoxShadow(
                  color: AppColors.primary.withOpacity(0.25),
                  offset: const Offset(0, 4), blurRadius: 12,
                )]
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: AppRadius.rlg,
          child: InkWell(
            onTap: disabled ? null : onPressed,
            borderRadius: AppRadius.rlg,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Center(child: child),
            ),
          ),
        ),
      ),
    );
  }

  _ButtonColors _resolveColors(BuildContext c, bool disabled) {
    final isDark = Theme.of(c).brightness == Brightness.dark;
    if (disabled) {
      return _ButtonColors(
        bg: AppColors.surface(c),
        fg: AppColors.textTertiary(c),
        border: variant == AppButtonVariant.secondary ? AppColors.border(c) : null,
      );
    }
    switch (variant) {
      case AppButtonVariant.primary:
        return _ButtonColors(bg: AppColors.primary, fg: Colors.white);
      case AppButtonVariant.secondary:
        return _ButtonColors(
          bg: isDark ? AppColors.darkSurface : Colors.white,
          fg: AppColors.primary,
          border: AppColors.primary,
        );
      case AppButtonVariant.ghost:
        return _ButtonColors(
          bg: Colors.transparent, fg: AppColors.primary,
        );
      case AppButtonVariant.danger:
        return _ButtonColors(bg: AppColors.error, fg: Colors.white);
    }
  }
}

class _ButtonColors {
  final Color bg;
  final Color fg;
  final Color? border;
  _ButtonColors({required this.bg, required this.fg, this.border});
}
