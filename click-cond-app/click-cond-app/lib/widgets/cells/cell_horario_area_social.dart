import 'package:click/pages/shared/areas%20sociais/new_area_social.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class CellHorarioAreaSocial extends StatelessWidget {
  final HorarioModel horario;
  final VoidCallback? onDelete;
  final VoidCallback? onChangeDe;
  final VoidCallback? onChangeAte;

  const CellHorarioAreaSocial({
    Key? key,
    required this.horario,
    required this.onDelete,
    required this.onChangeDe,
    required this.onChangeAte,
  }) : super(key: key);

  String _calcDuration(String de, String ate) {
    try {
      final pDe = de.split(':');
      final pAte = ate.split(':');
      final mDe = int.parse(pDe[0]) * 60 + int.parse(pDe[1]);
      final mAte = int.parse(pAte[0]) * 60 + int.parse(pAte[1]);
      final diff = mAte - mDe;
      if (diff <= 0) return '';
      final h = diff ~/ 60;
      final m = diff % 60;
      if (m == 0) return '${h}h';
      return '${h}h ${m}m';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final duration = _calcDuration(horario.horarioDe, horario.horarioAte);

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B).withOpacity(0.5) : const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0),
          width: 1,
        ),
      ),
      child: Row(
        children: [
          // Campo "De" (Início)
          Expanded(
            child: InkWell(
              onTap: onChangeDe,
              borderRadius: BorderRadius.circular(10),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF0F172A) : Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: AppColors.primary.withOpacity(0.25),
                    width: 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      PhosphorIcons.clock,
                      size: 16,
                      color: AppColors.primary,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'INÍCIO',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.5,
                              color: AppColors.textSecondary(context),
                            ),
                          ),
                          const SizedBox(height: 1),
                          Text(
                            horario.horarioDe.isNotEmpty ? horario.horarioDe : '00:00',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: AppColors.textPrimary(context),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      PhosphorIcons.caretDownBold,
                      size: 12,
                      color: AppColors.textSecondary(context),
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Seta central com duração
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  PhosphorIcons.arrowRightBold,
                  size: 14,
                  color: AppColors.primary,
                ),
                if (duration.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      duration,
                      style: const TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),

          // Campo "Até" (Fim)
          Expanded(
            child: InkWell(
              onTap: onChangeAte,
              borderRadius: BorderRadius.circular(10),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: isDark ? const Color(0xFF0F172A) : Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: AppColors.primary.withOpacity(0.25),
                    width: 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      PhosphorIcons.clockAfternoon,
                      size: 16,
                      color: AppColors.primary,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'FIM',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.5,
                              color: AppColors.textSecondary(context),
                            ),
                          ),
                          const SizedBox(height: 1),
                          Text(
                            horario.horarioAte.isNotEmpty ? horario.horarioAte : '00:00',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                              color: AppColors.textPrimary(context),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      PhosphorIcons.caretDownBold,
                      size: 12,
                      color: AppColors.textSecondary(context),
                    ),
                  ],
                ),
              ),
            ),
          ),

          const SizedBox(width: 8),

          // Botão Excluir
          InkWell(
            onTap: onDelete,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: isDark
                    ? const Color(0xFF7F1D1D).withOpacity(0.25)
                    : const Color(0xFFFEE2E2),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: isDark
                      ? const Color(0xFFEF4444).withOpacity(0.3)
                      : const Color(0xFFFECACA),
                ),
              ),
              child: const Icon(
                PhosphorIcons.trashBold,
                size: 16,
                color: Color(0xFFEF4444),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
