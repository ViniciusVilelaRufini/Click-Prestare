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
    final fg = info.corTexto(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Semantics(
      label: 'Status: ${info.rotulo}',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: AppSpacing.xs),
        decoration: BoxDecoration(
          color: info.cor.withValues(alpha: isDark ? 0.18 : 0.12),
          borderRadius: BorderRadius.circular(AppRadius.full),
          border: Border.all(color: info.cor.withValues(alpha: isDark ? 0.4 : 0.3)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(info.icone, size: 14, color: fg),
            const SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text(
                info.rotulo,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.caption(context).copyWith(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: fg,
                  height: 1.3,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
