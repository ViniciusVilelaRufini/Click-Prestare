import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Dialog padrão modernizado.
Future<void> showAppDialog(
  BuildContext context, {
  required String title,
  required String message,
  String okLabel = 'OK',
  IconData? icon,
  Color? iconColor,
}) async {
  await showDialog<void>(
    context: context,
    builder: (c) => Dialog(
      backgroundColor: AppColors.bg(c),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.xxl)),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Container(
                padding: const EdgeInsets.all(AppSpacing.lg),
                decoration: BoxDecoration(
                  color: (iconColor ?? AppColors.primary).withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: iconColor ?? AppColors.primary, size: 32),
              ),
              AppSpacing.gapLg,
            ],
            Text(title, style: AppTypography.headline(c), textAlign: TextAlign.center),
            AppSpacing.gapSm,
            Text(message, style: AppTypography.bodySecondary(c), textAlign: TextAlign.center),
            AppSpacing.gapXl,
            AppButton(
              label: okLabel,
              onPressed: () => Navigator.pop(c),
            ),
          ],
        ),
      ),
    ),
  );
}

/// Dialog de confirmação (sim/não).
Future<bool> showAppConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Confirmar',
  String cancelLabel = 'Cancelar',
  bool isDanger = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (c) => Dialog(
      backgroundColor: AppColors.bg(c),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.xxl)),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: (isDanger ? AppColors.error : AppColors.warning).withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              child: Icon(
                PhosphorIcons.warning,
                color: isDanger ? AppColors.error : AppColors.warning,
                size: 32,
              ),
            ),
            AppSpacing.gapLg,
            Text(title, style: AppTypography.headline(c), textAlign: TextAlign.center),
            AppSpacing.gapSm,
            Text(message, style: AppTypography.bodySecondary(c), textAlign: TextAlign.center),
            AppSpacing.gapXl,
            Row(
              children: [
                Expanded(
                  child: AppButton(
                    label: cancelLabel,
                    variant: AppButtonVariant.secondary,
                    onPressed: () => Navigator.pop(c, false),
                  ),
                ),
                AppSpacing.gapMd,
                Expanded(
                  child: AppButton(
                    label: confirmLabel,
                    variant: isDanger ? AppButtonVariant.danger : AppButtonVariant.primary,
                    onPressed: () => Navigator.pop(c, true),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  return result ?? false;
}
