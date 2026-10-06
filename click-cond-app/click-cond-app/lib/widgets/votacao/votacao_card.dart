import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'votacao_helpers.dart' as h;
import 'votacao_status_badge.dart';

/// Card de uma votação/enquete na lista: ícone tingido pela cor do status,
/// título (até 2 linhas), subtítulo opcional, selo de status, chip de prazo
/// ("Encerra em 3 dias") e total de votos. Com [onTap] o card inteiro é
/// tocável (altura mínima 72dp) e mostra a seta.
///
/// Para um item cru da API use [VotacaoCard.fromItem].
class VotacaoCard extends StatelessWidget {
  /// Título da votação.
  final String titulo;

  /// Status cru: 0 agendada, 1 em andamento, 2 finalizada.
  final dynamic status;

  /// `'dd/MM/yyyy'` — usado no prazo de votação agendada.
  final String? dataInicio;

  /// `'dd/MM/yyyy'` — usado no prazo de votação em andamento.
  final String? dataTermino;

  /// Total de votos; nulo esconde a contagem.
  final int? totalVotos;

  /// Linha extra sob o título (ex.: descrição ou nome da assembleia).
  final String? subtitulo;

  /// Toque no card; nulo deixa o card só informativo.
  final VoidCallback? onTap;

  /// "Agora" para o cálculo do prazo (testes).
  final DateTime? agora;

  const VotacaoCard({
    super.key,
    required this.titulo,
    required this.status,
    this.dataInicio,
    this.dataTermino,
    this.totalVotos,
    this.subtitulo,
    this.onTap,
    this.agora,
  });

  /// Monta a partir do item da API (`titulo` ou `pergunta`, `status`,
  /// `data_inicio`, `data_termino`, `opcoes` → total de votos). [subtitulo]
  /// não é lido do item: passe `item['descricao']` se quiser mostrá-la.
  factory VotacaoCard.fromItem(
    dynamic item, {
    Key? key,
    String? subtitulo,
    VoidCallback? onTap,
    DateTime? agora,
  }) {
    final m = item is Map ? item : const {};
    String txt(String k) => h.textoLimpo(m[k]);

    final titulo = txt('titulo').isNotEmpty ? txt('titulo') : txt('pergunta');
    return VotacaoCard(
      key: key,
      titulo: titulo,
      status: m['status'],
      dataInicio: txt('data_inicio'),
      dataTermino: txt('data_termino'),
      totalVotos: m['opcoes'] is List ? h.totalVotos(m['opcoes']) : null,
      subtitulo: subtitulo,
      onTap: onTap,
      agora: agora,
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final info = h.statusVotacaoInfo(status);
    final prazo = h.prazoLabel(dataTermino, status, dataInicio: dataInicio, agora: agora);
    final votos = totalVotos == null ? null : h.votosLabel(totalVotos!);
    final sub = (subtitulo ?? '').trim();

    final semantica = [
      titulo,
      if (sub.isNotEmpty) sub,
      info.rotulo,
      if (prazo.isNotEmpty) prazo,
      if (votos != null) votos,
    ].join(', ');

    final secundario = AppTypography.caption(context).copyWith(fontSize: 13);

    Widget meta(IconData icone, String texto, {Color? cor}) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 15, color: cor ?? AppColors.textTertiary(context)),
            const SizedBox(width: AppSpacing.xs),
            Flexible(
              child: Text(
                texto,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: cor == null ? secundario : secundario.copyWith(color: cor, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        );

    // "Encerra hoje/amanhã" pede atenção: prazo em âmbar (a cor de texto do
    // status agendado, já ajustada para contraste em cada tema).
    final urgente = h.prazoUrgente(dataTermino, status, agora: agora);
    final corPrazo = urgente ? h.statusVotacaoInfo(0).corTexto(context) : null;

    // excludeSemantics descarta a semântica do InkWell (inclusive a ação de
    // toque), então o onTap precisa ser repassado aqui — senão o toque duplo
    // do TalkBack/VoiceOver não faz nada.
    return Semantics(
      container: true,
      button: onTap != null,
      label: semantica,
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: AppColors.surfaceElevated(context),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.rlg,
          side: BorderSide(color: AppColors.border(context)),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 72),
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: info.cor.withValues(alpha: isDark ? 0.2 : 0.1),
                      borderRadius: AppRadius.rmd,
                    ),
                    child: Icon(PhosphorIcons.chartBar, color: info.corTexto(context), size: 22),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          titulo,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600, height: 1.35),
                        ),
                        if (sub.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(sub, maxLines: 2, overflow: TextOverflow.ellipsis, style: secundario),
                        ],
                        const SizedBox(height: AppSpacing.sm),
                        Wrap(
                          spacing: AppSpacing.md,
                          runSpacing: AppSpacing.xs,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            VotacaoStatusBadge(status: status),
                            if (prazo.isNotEmpty) meta(PhosphorIcons.clock, prazo, cor: corPrazo),
                            if (votos != null) meta(PhosphorIcons.users, votos),
                          ],
                        ),
                      ],
                    ),
                  ),
                  if (onTap != null) ...[
                    const SizedBox(width: AppSpacing.sm),
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Icon(PhosphorIcons.caretRight, size: 18, color: AppColors.textTertiary(context)),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
