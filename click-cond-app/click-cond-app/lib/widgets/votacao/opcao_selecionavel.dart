import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'votacao_helpers.dart';

/// Card de uma opção para escolher antes de votar, com comportamento de rádio:
/// círculo vazio ou check preenchido e, quando [selecionado], borda/fundo na
/// cor primária. Altura mínima de 56dp.
///
/// Desabilitado ([habilitado] falso ou [onTap] nulo) fica esmaecido e não
/// responde ao toque. Use um por opção e controle a seleção na tela.
class OpcaoSelecionavel extends StatelessWidget {
  /// Texto da opção.
  final String rotulo;

  /// Se é a opção escolhida.
  final bool selecionado;

  /// Toque no card (normalmente: marcar esta opção).
  final VoidCallback? onTap;

  /// Falso desabilita o card (ex.: votação agendada ou enviando o voto).
  final bool habilitado;

  const OpcaoSelecionavel({
    super.key,
    required this.rotulo,
    required this.selecionado,
    this.onTap,
    this.habilitado = true,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final destaque = corDestaqueVotacao(context);
    final ativo = habilitado && onTap != null;
    final acao = ativo ? onTap : null;

    // excludeSemantics descarta a semântica do InkWell (inclusive a ação de
    // toque), então o onTap precisa ser repassado aqui — senão o toque duplo
    // do TalkBack/VoiceOver não faz nada.
    return Semantics(
      container: true,
      inMutuallyExclusiveGroup: true,
      checked: selecionado,
      enabled: ativo,
      label: rotulo,
      onTap: acao,
      excludeSemantics: true,
      child: Opacity(
        opacity: ativo ? 1 : 0.55,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          constraints: const BoxConstraints(minHeight: 56),
          decoration: BoxDecoration(
            color: selecionado
                ? AppColors.primary.withValues(alpha: isDark ? 0.18 : 0.06)
                : AppColors.surfaceElevated(context),
            borderRadius: AppRadius.rlg,
            border: Border.all(
              color: selecionado ? destaque : AppColors.border(context),
              width: selecionado ? 1.5 : 1,
            ),
          ),
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              onTap: acao,
              borderRadius: AppRadius.rlg,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
                child: Row(
                  children: [
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 180),
                      transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
                      child: selecionado
                          ? Icon(PhosphorIcons.checkCircleFill,
                              key: const ValueKey('sel'), size: 24, color: destaque)
                          : Icon(PhosphorIcons.circle,
                              key: const ValueKey('nao'), size: 24, color: AppColors.textTertiary(context)),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Text(
                        rotulo,
                        style: AppTypography.bodyMedium(context).copyWith(
                          fontSize: 15,
                          fontWeight: selecionado ? FontWeight.w600 : FontWeight.w500,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
