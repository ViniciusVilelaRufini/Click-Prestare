import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'votacao_helpers.dart';

/// Resultado de uma opção: rótulo, percentual em destaque, barra que anima de
/// 0 até [percentual] e a contagem de votos. Quando [meuVoto], o card ganha
/// borda/fundo na cor primária e o selo "Seu voto".
///
/// Só exibe (sem toque). Para os percentuais somarem 100, calcule-os juntos
/// com [percentuais] (de `votacao_helpers.dart`).
class OpcaoResultadoBar extends StatelessWidget {
  /// Chave do `FractionallySizedBox` da barra preenchida (testes).
  static const chaveBarra = Key('opcao-resultado-barra');

  /// Texto da opção.
  final String rotulo;

  /// Votos da opção.
  final int votos;

  /// 0–100 (valores fora da faixa são limitados).
  final int percentual;

  /// Se esta é a opção em que o usuário votou.
  final bool meuVoto;

  const OpcaoResultadoBar({
    super.key,
    required this.rotulo,
    required this.votos,
    required this.percentual,
    this.meuVoto = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final destaque = corDestaqueVotacao(context);
    final pct = percentual.clamp(0, 100);
    final votosTxt = votosLabel(votos);
    // "Reduzir movimento" do sistema: barra já no valor final, sem transição.
    final reduzir = MediaQuery.maybeDisableAnimationsOf(context) ?? false;

    final corBarra = meuVoto ? destaque : destaque.withValues(alpha: isDark ? 0.55 : 0.45);
    final corTrilho = isDark ? Colors.white.withValues(alpha: 0.08) : AppColors.primary.withValues(alpha: 0.08);

    return Semantics(
      container: true,
      label: '$rotulo: $pct%, $votosTxt${meuVoto ? ', seu voto' : ''}',
      excludeSemantics: true,
      child: AnimatedContainer(
        duration: reduzir ? Duration.zero : const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
        decoration: BoxDecoration(
          color: meuVoto
              ? AppColors.primary.withValues(alpha: isDark ? 0.16 : 0.05)
              : AppColors.surfaceElevated(context),
          borderRadius: AppRadius.rlg,
          border: Border.all(
            color: meuVoto ? destaque : AppColors.border(context),
            width: meuVoto ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    rotulo,
                    style: AppTypography.bodyMedium(context).copyWith(
                      fontSize: 15,
                      fontWeight: meuVoto ? FontWeight.w600 : FontWeight.w500,
                      height: 1.35,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Text(
                  '$pct%',
                  style: AppTypography.bodyMedium(context).copyWith(
                    fontWeight: FontWeight.w700,
                    color: meuVoto ? destaque : AppColors.textPrimary(context),
                    height: 1.35,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.full),
              child: Container(
                height: 8,
                color: corTrilho,
                alignment: Alignment.centerLeft,
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: reduzir ? pct / 100 : 0, end: pct / 100),
                  duration: reduzir ? Duration.zero : const Duration(milliseconds: 700),
                  curve: Curves.easeOutCubic,
                  builder: (_, v, __) => FractionallySizedBox(
                    key: chaveBarra,
                    widthFactor: v,
                    heightFactor: 1,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: corBarra,
                        borderRadius: BorderRadius.circular(AppRadius.full),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(votosTxt, style: AppTypography.caption(context).copyWith(fontSize: 13)),
                if (meuVoto)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
                    decoration: BoxDecoration(
                      color: destaque.withValues(alpha: isDark ? 0.2 : 0.1),
                      borderRadius: BorderRadius.circular(AppRadius.full),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(PhosphorIcons.checkCircleFill, size: 14, color: destaque),
                        const SizedBox(width: AppSpacing.xs),
                        Text(
                          'Seu voto',
                          style: AppTypography.tiny(context).copyWith(color: destaque, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
