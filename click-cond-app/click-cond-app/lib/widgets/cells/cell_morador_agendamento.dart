import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class CellMoradorAgendamento extends StatelessWidget {
  final dynamic item;
  final bool canEdit;

  const CellMoradorAgendamento({
    super.key,
    required this.item,
    required this.canEdit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: canEdit 
              ? AppColors.primary.withValues(alpha: 0.24) 
              : AppColors.border(context),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          children: [
            // Badge com ícone de casa
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: (canEdit ? AppColors.primary : AppColors.textSecondary(context)).withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                PhosphorIcons.house,
                color: canEdit ? AppColors.primary : AppColors.textSecondary(context),
                size: 20,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            
            // Informações do agendamento
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${getText('lb_bloco')} ${item['bloco']}  •  ${getText('lb_apto')} ${item['apto']}',
                    style: AppTypography.bodyMedium(context).copyWith(
                      color: AppColors.textPrimary(context),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        PhosphorIcons.calendarBlank,
                        size: 14,
                        color: AppColors.textSecondary(context),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          '${item['data']}  •  ${item['horaDe']} às ${item['horaAte']}',
                          style: AppTypography.caption(context).copyWith(
                            color: AppColors.textSecondary(context),
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            
            // Botão de editar (se elegível)
            if (canEdit) ...[
              const SizedBox(width: AppSpacing.sm),
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  PhosphorIcons.pencil,
                  color: AppColors.primary,
                  size: 16,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
