import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/utils/utils.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class CellVotacao extends StatelessWidget {
  final bool? hasArrow;
  final dynamic item;
  final List<dynamic> meusVotos;
  final bool isRegister;
  final VoidCallback onPressedDelete;
  final Function(int) onPressedChoice;
  final String? title;

  const CellVotacao({
    Key? key,
    required this.item, 
    required this.meusVotos, 
    this.hasArrow, 
    this.title,
    required this.isRegister,
    required this.onPressedDelete,
    required this.onPressedChoice, 
  }) : super(key: key);

  Widget _buildOptionRow(BuildContext context, dynamic item, String id, String text, int votesCount) {
    final isSelected = meusVotos.contains(id);
    final isClosed = item['status'] != 1;
    
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: InkWell(
        onTap: () {
          if (isClosed) {
            displayMessage(context, getText('alert_ops'), getText('votacao_fora_periodo'));
          } else {
            onPressedChoice(int.parse(id));
          }
        },
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.md),
          decoration: BoxDecoration(
            color: isSelected 
                ? AppColors.primary.withOpacity(0.08) 
                : AppColors.surface(context),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected ? AppColors.primary : AppColors.border(context),
              width: isSelected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                isSelected ? PhosphorIcons.checkCircleFill : PhosphorIcons.circle,
                color: isSelected ? AppColors.primary : AppColors.textTertiary(context),
                size: 20,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  text,
                  style: AppTypography.bodyMedium(context).copyWith(
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
                    color: AppColors.textPrimary(context),
                  ),
                ),
              ),
              if (!isRegister)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: isSelected 
                        ? AppColors.primary.withOpacity(0.12) 
                        : AppColors.bg(context),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    votesCount == 1 ? '1 voto' : '$votesCount votos',
                    style: AppTypography.caption(context).copyWith(
                      color: isSelected ? AppColors.primary : AppColors.textSecondary(context),
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border(context)),
      ),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                PhosphorIcons.calendarBlank,
                size: 16,
                color: AppColors.textSecondary(context),
              ),
              const SizedBox(width: 6),
              Text(
                '${getText('label_of')} ${item['data_inicio']} ${getText('label_until')} ${item['data_termino']}',
                style: AppTypography.caption(context).copyWith(
                  color: AppColors.textSecondary(context),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            title ?? item['titulo'] ?? '',
            style: AppTypography.bodyMedium(context).copyWith(
              fontWeight: FontWeight.bold,
              color: AppColors.textPrimary(context),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          for (var opcao in item['opcoes'])
            _buildOptionRow(
              context,
              item,
              opcao.split(';')[0],
              opcao.split(';')[1],
              int.tryParse(opcao.split(';')[2]) ?? 0,
            ),
          if (getUserType() == "sindico" && !isRegister) ...[
            const SizedBox(height: AppSpacing.md),
            const Divider(),
            const SizedBox(height: AppSpacing.sm),
            Center(
              child: TextButton.icon(
                onPressed: onPressedDelete,
                style: TextButton.styleFrom(
                  foregroundColor: Colors.red,
                ),
                icon: const Icon(PhosphorIcons.trash, size: 16),
                label: Text(
                  getText("btn_delete"),
                  style: AppTypography.body(context).copyWith(
                    color: Colors.red,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
