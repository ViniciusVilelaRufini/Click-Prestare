import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'votacao_helpers.dart';

/// Escolha da unidade pela qual votar, para quem tem MAIS de uma unidade no
/// condomínio (cada unidade tem um voto). Cada linha mostra o rótulo da
/// unidade e o voto atual dela ("Voto atual: Sim" / "Ainda não votou").
///
/// Com uma unidade a tela não mostra este seletor. [opcoes] traduz o id da
/// opção votada no nome. [habilitado] falso (votação fora do período ou
/// enviando) só mostra, sem trocar.
class SeletorUnidadeVoto extends StatelessWidget {
  /// Id da votação (como veio da API), só para as chaves das linhas.
  final dynamic idVotacao;
  final List<UnidadeVoto> unidades;
  final List<OpcaoVotacao> opcoes;
  final int? selecionada;
  final ValueChanged<int>? onChanged;
  final bool habilitado;

  const SeletorUnidadeVoto({
    super.key,
    required this.idVotacao,
    required this.unidades,
    required this.opcoes,
    required this.selecionada,
    this.onChanged,
    this.habilitado = true,
  });

  /// Linha de uma unidade (a votação entra na chave: a assembleia tem várias).
  static Key chaveUnidade(dynamic idVotacao, int idApto) => ValueKey('votacao-$idVotacao-unidade-$idApto');

  String _subtitulo(UnidadeVoto u) {
    if (!u.votou) return getText('votacao_unidade_sem_voto');
    final nome = opcoes.where((o) => o.id == u.opcao).map((o) => o.nome).firstOrNull;
    return '${getText('votacao_unidade_voto_atual')}: ${nome ?? u.opcao}';
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          getText('votacao_unidade_titulo').toUpperCase(),
          style: AppTypography.captionMedium(context).copyWith(
            fontWeight: FontWeight.w700,
            color: AppColors.textSecondary(context),
          ),
        ),
        const SizedBox(height: 2),
        Text(
          getText('votacao_unidade_ajuda'),
          style: AppTypography.caption(context).copyWith(color: AppColors.textSecondary(context), height: 1.4),
        ),
        const SizedBox(height: AppSpacing.sm),
        for (final u in unidades)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.xs),
            child: _LinhaUnidade(
              key: chaveUnidade(idVotacao, u.idApto),
              rotulo: u.rotulo,
              subtitulo: _subtitulo(u),
              votou: u.votou,
              selecionada: u.idApto == selecionada,
              onTap: habilitado && onChanged != null ? () => onChanged!(u.idApto) : null,
            ),
          ),
      ],
    );
  }
}

class _LinhaUnidade extends StatelessWidget {
  final String rotulo;
  final String subtitulo;
  final bool votou;
  final bool selecionada;
  final VoidCallback? onTap;

  const _LinhaUnidade({
    super.key,
    required this.rotulo,
    required this.subtitulo,
    required this.votou,
    required this.selecionada,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final destaque = corDestaqueVotacao(context);
    return Semantics(
      container: true,
      inMutuallyExclusiveGroup: true,
      checked: selecionada,
      enabled: onTap != null,
      label: '$rotulo. $subtitulo',
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: selecionada ? AppColors.primary.withValues(alpha: isDark ? 0.18 : 0.06) : AppColors.surface(context),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.rmd,
          side: BorderSide(
            color: selecionada ? destaque : AppColors.border(context),
            width: selecionada ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
              child: Row(
                children: [
                  Icon(
                    selecionada ? PhosphorIcons.radioButtonFill : PhosphorIcons.circle,
                    size: 20,
                    color: selecionada ? destaque : AppColors.textTertiary(context),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          rotulo,
                          style: AppTypography.bodyMedium(context).copyWith(
                            fontWeight: selecionada ? FontWeight.w600 : FontWeight.w500,
                            color: AppColors.textPrimary(context),
                          ),
                        ),
                        Text(
                          subtitulo,
                          style: AppTypography.caption(context).copyWith(
                            color: votou ? statusVotacaoInfo(1).corTexto(context) : AppColors.textSecondary(context),
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
