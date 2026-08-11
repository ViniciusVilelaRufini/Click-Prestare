import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class CellMyAgendamento extends StatelessWidget {
  final dynamic item;

  const CellMyAgendamento({
    Key? key,
    required this.item,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final String apto = item['apto']?.toString() ?? '';
    final String blocoRaw = item['bloco']?.toString() ?? '';
    String blocoText = '';
    if (blocoRaw.isNotEmpty) {
      final blocoLower = blocoRaw.toLowerCase();
      if (blocoLower.contains('bloco') ||
          blocoLower.contains('bloque') ||
          blocoLower.contains('block')) {
        blocoText = blocoRaw;
      } else {
        blocoText = '${getText('lb_bloco')} $blocoRaw';
      }
    }
    final String aptoBlocoTitle =
        '${getText('lb_apto')} $apto ${blocoText.isNotEmpty ? "- $blocoText" : ""}';

    final String status =
        item['status']?.toString().toLowerCase() ?? 'pendente';
    String statusText = getText('lb_pendente');
    Color statusColor = const Color(0xFFF59E0B);
    IconData statusIcon = PhosphorIcons.clock;

    if (status == 'aprovado' || status == 'confirmado') {
      statusText = getText('lb_aprovado');
      statusColor = const Color(0xFF10B981);
      statusIcon = PhosphorIcons.checkCircle;
    } else if (status == 'recusado' || status == 'cancelado') {
      statusText = getText('lb_recusado');
      statusColor = const Color(0xFFEF4444);
      statusIcon = PhosphorIcons.xCircle;
    }

    final nomeArea = item['nomeArea']?.toString() ?? 'Área Social';
    final dataReserva = item['data']?.toString() ?? '';
    final horaDe = item['horaDe']?.toString() ?? '';
    final horaAte = item['horaAte']?.toString() ?? '';
    final horario = (horaDe.isNotEmpty && horaAte.isNotEmpty)
        ? '$horaDe às $horaAte'
        : horaDe;
    final dataCriacao = item['data_criacao']?.toString() ?? '';

    return Container(
      margin: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.xs + 1,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border(context)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Linha lateral de cor de status
              Container(
                width: 4,
                color: statusColor,
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Top row: Nome da Área e Badge de Status
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              nomeArea,
                              style: TextStyle(
                                color: AppColors.textPrimary(context),
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: statusColor.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: statusColor.withOpacity(0.3),
                              ),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(statusIcon, size: 12, color: statusColor),
                                const SizedBox(width: 4),
                                Text(
                                  statusText,
                                  style: TextStyle(
                                    color: statusColor,
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      // Data e Horário da Reserva
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: AppColors.bg(context),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Row(
                                children: [
                                  Icon(PhosphorIcons.calendarBlank,
                                      size: 15, color: AppColors.primary),
                                  const SizedBox(width: 6),
                                  Text(
                                    dataReserva,
                                    style: TextStyle(
                                      color: AppColors.textPrimary(context),
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (horario.isNotEmpty)
                              Row(
                                children: [
                                  Icon(PhosphorIcons.clock,
                                      size: 15, color: AppColors.primary),
                                  const SizedBox(width: 6),
                                  Text(
                                    horario,
                                    style: TextStyle(
                                      color: AppColors.textPrimary(context),
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 10),
                      // Rodapé: Unidade e Data da Solicitação
                      Row(
                        children: [
                          if (aptoBlocoTitle.isNotEmpty) ...[
                            Icon(PhosphorIcons.house,
                                size: 14, color: AppColors.textTertiary(context)),
                            const SizedBox(width: 4),
                            Text(
                              aptoBlocoTitle,
                              style: TextStyle(
                                color: AppColors.textSecondary(context),
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                          const Spacer(),
                          if (dataCriacao.isNotEmpty)
                            Text(
                              dataCriacao,
                              style: TextStyle(
                                color: AppColors.textTertiary(context),
                                fontSize: 11,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
