import 'package:click/theme/app_typography.dart';
import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:flutter/material.dart';

import 'reserva_helpers.dart';

/// Selo (pílula) com ícone + rótulo do status da reserva, na cor semântica de
/// [statusReservaInfo]: Pendente (âmbar), Aprovada (verde), Recusada
/// (vermelho), Cancelada/desconhecido (cinza).
class ReservaStatusBadge extends StatelessWidget {
  /// Status cru vindo da API (`pendente`, `aprovado`, `recusado`, `cancelado`).
  final String? status;

  const ReservaStatusBadge({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final info = statusReservaInfo(status);

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
