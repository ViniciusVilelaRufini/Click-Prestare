import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/app/app_card.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// Dialog padrão.
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
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              AppIconBox(icon: icon, size: 52, iconSize: 24, color: iconColor),
              AppSpacing.gapLg,
            ],
            Text(
              title.toUpperCase(),
              style: AppTypography.title(c),
              textAlign: TextAlign.center,
            ),
            AppSpacing.gapSm,
            Text(
              message,
              style: AppTypography.bodySecondary(c),
              textAlign: TextAlign.center,
            ),
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
  IconData? icon,
  Color? iconColor,
}) async {
  final effectiveIcon = icon ?? PhosphorIcons.warning;

  final result = await showDialog<bool>(
    context: context,
    builder: (c) => Dialog(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppIconBox(
              icon: effectiveIcon,
              size: 52,
              iconSize: 24,
              color: iconColor ??
                  (isDanger ? AppColors.signalDanger(c) : AppColors.signalWarn(c)),
            ),
            AppSpacing.gapLg,
            Text(
              title.toUpperCase(),
              style: AppTypography.title(c),
              textAlign: TextAlign.center,
            ),
            AppSpacing.gapSm,
            Text(
              message,
              style: AppTypography.bodySecondary(c),
              textAlign: TextAlign.center,
            ),
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
                AppSpacing.gapSm,
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
