import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

import 'votacao_helpers.dart';

/// Selo (pílula) com ícone + rótulo do status da votação, na cor semântica de
/// [statusVotacaoInfo]: Agendado (âmbar), Em andamento (verde), Finalizado
/// (cinza). Mesmo desenho do `ReservaStatusBadge` das Áreas Sociais.
class VotacaoStatusBadge extends StatelessWidget {
  /// Status cru da API: 0 agendada, 1 em andamento, 2 finalizada (int ou texto).
  final dynamic status;

  const VotacaoStatusBadge({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final info = statusVotacaoInfo(status);

    return Semantics(
      label: 'Status: ${info.rotulo}',
      excludeSemantics: true,
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
            Container(
              width: 6,
              height: 6,
              decoration:
                  BoxDecoration(shape: BoxShape.circle, color: info.cor),
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                info.rotulo.toUpperCase(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.label(context).copyWith(
                  color: AppColors.textSecondary(context),
                  fontSize: 10,
                  letterSpacing: 10 * 0.18,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
