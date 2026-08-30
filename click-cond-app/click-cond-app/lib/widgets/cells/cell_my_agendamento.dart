import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

class CellMyAgendamento extends StatelessWidget {
  final dynamic item;
  final Function(int id)? onCancel;

  const CellMyAgendamento({
    Key? key,
    required this.item,
    this.onCancel,
  }) : super(key: key);

  void _mostrarModalCancelar(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Cancelar Agendamento', style: TextStyle(fontWeight: FontWeight.bold)),
        content: const Text(
          'Tem certeza que deseja cancelar sua reserva? O horário voltará a ficar disponível para outros moradores.',
          style: TextStyle(fontSize: 13.5),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Voltar', style: TextStyle(color: AppColors.textSecondary(context))),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              final rawId = item['id'];
              final id = rawId is int ? rawId : int.tryParse(rawId.toString()) ?? 0;
              onCancel?.call(id);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFFEF4444),
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: const Text('Sim, Cancelar', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
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
    final bool isPendente = status == 'pendente';
    final bool isAprovado = status == 'aprovado' || status == 'confirmado';
    final bool isCancelavel = isPendente || isAprovado;

    String statusText = getText('lb_pendente');
    Color statusColor = const Color(0xFFF59E0B);
    IconData statusIcon = PhosphorIcons.clock;

    if (isAprovado) {
      statusText = getText('lb_aprovado');
      statusColor = const Color(0xFF10B981);
      statusIcon = PhosphorIcons.checkCircle;
    } else if (status == 'recusado') {
      statusText = getText('lb_recusado');
      statusColor = const Color(0xFFEF4444);
      statusIcon = PhosphorIcons.xCircle;
    } else if (status == 'cancelado') {
      statusText = getText('lb_cancelado');
      statusColor = AppColors.textSecondary(context);
      statusIcon = PhosphorIcons.prohibit;
    } else if (status != 'pendente') {
      statusText = item['status']?.toString() ?? statusText;
      statusColor = AppColors.textSecondary(context);
      statusIcon = PhosphorIcons.question;
    }

    final nomeArea = item['nomeArea']?.toString() ?? 'Área Social';
    final dataReserva = item['data']?.toString() ?? '';
    final horaDe = item['horaDe']?.toString() ?? '';
    final horaAte = item['horaAte']?.toString() ?? '';
    final horario = (horaDe.isNotEmpty && horaAte.isNotEmpty)
        ? '$horaDe às $horaAte'
        : horaDe;
    final dataCriacao = item['data_criacao']?.toString() ?? '';
    final aprovadoPor = item['aprovado_por']?.toString() ?? (isAprovado ? 'Síndico' : null);
    final aprovadoEm = item['aprovado_em']?.toString();
    final motivoRecusa = item['motivo_recusa']?.toString();

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

                      // Detalhe de quem aprovou/recusou/cancelou
                      if (aprovadoPor != null && aprovadoPor.isNotEmpty) ...[
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: statusColor.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: statusColor.withOpacity(0.2)),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                isAprovado
                                    ? PhosphorIcons.checkCircle
                                    : (status == 'recusado' ? PhosphorIcons.xCircle : PhosphorIcons.prohibit),
                                size: 14,
                                color: statusColor,
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  isAprovado
                                      ? 'Aprovado por $aprovadoPor${aprovadoEm != null ? " ($aprovadoEm)" : ""}'
                                      : (status == 'recusado'
                                          ? 'Recusado por $aprovadoPor${motivoRecusa != null && motivoRecusa.isNotEmpty ? " • Motivo: $motivoRecusa" : ""}'
                                          : '$aprovadoPor'),
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w600,
                                    color: isDark ? statusColor.withOpacity(0.9) : (isAprovado ? const Color(0xFF065F46) : const Color(0xFF991B1B)),
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],

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

                      // Botão de Cancelar Reserva para o morador
                      if (isCancelavel && onCancel != null) ...[
                        const SizedBox(height: 10),
                        const Divider(height: 1),
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton.icon(
                            onPressed: () => _mostrarModalCancelar(context),
                            style: TextButton.styleFrom(
                              foregroundColor: const Color(0xFFEF4444),
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            ),
                            icon: const Icon(PhosphorIcons.xCircle, size: 15),
                            label: const Text(
                              'Cancelar Agendamento',
                              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
                            ),
                          ),
                        ),
                      ],
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
