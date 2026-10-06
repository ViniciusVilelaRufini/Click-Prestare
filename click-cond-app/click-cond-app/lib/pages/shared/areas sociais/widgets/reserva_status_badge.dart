import 'package:click/theme/app_spacing.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

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
                style: GoogleFonts.poppins(
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
