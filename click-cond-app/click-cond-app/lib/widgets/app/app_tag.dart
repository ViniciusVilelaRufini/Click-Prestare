import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

/// Sinal de estado: a única cor do tema, sempre pequena.
enum AppSignal { neutral, ok, warn, danger }

/// `.dot`: ponto de 6px na cor do sinal.
class AppDot extends StatelessWidget {
  final AppSignal signal;

  const AppDot({super.key, this.signal = AppSignal.neutral});

  static Color colorOf(BuildContext c, AppSignal signal) {
    switch (signal) {
      case AppSignal.neutral:
        return AppColors.textTertiary(c);
      case AppSignal.ok:
        return AppColors.signalOk(c);
      case AppSignal.warn:
        return AppColors.signalWarn(c);
      case AppSignal.danger:
        return AppColors.signalDanger(c);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: colorOf(context, signal),
      ),
    );
  }
}

/// `.tag`: selo de contorno, 22px, canto de 2px, com ponto opcional.
class AppTag extends StatelessWidget {
  final String label;

  /// Sem sinal, a tag não mostra ponto.
  final AppSignal? signal;

  const AppTag({super.key, required this.label, this.signal});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 22,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.borderStrong(context)),
        borderRadius: BorderRadius.circular(AppRadius.tag),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (signal != null) ...[
            AppDot(signal: signal!),
            const SizedBox(width: 6),
          ],
          Text(
            label.toUpperCase(),
            maxLines: 1,
            style: AppTypography.label(context).copyWith(
              color: AppColors.textSecondary(context),
              fontSize: 10,
              letterSpacing: 10 * 0.18,
            ),
          ),
        ],
      ),
    );
  }
}
