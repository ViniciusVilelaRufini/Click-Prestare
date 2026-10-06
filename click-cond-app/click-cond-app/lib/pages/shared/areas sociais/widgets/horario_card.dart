import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'reserva_helpers.dart';

/// Card selecionável de um horário livre: ícone de relógio, faixa
/// "10:00 – 16:00", duração ("6 h") e, quando [selecionado], borda e fundo na
/// cor primária com check. Altura mínima de 64dp.
///
/// Para o formato `'10:00 - 16:00'` de `new_reserva.dart`, use
/// [separarHorario] para obter [de] e [ate].
class HorarioCard extends StatelessWidget {
  /// Início ("HH:mm").
  final String de;

  /// Fim ("HH:mm").
  final String ate;

  /// Estado selecionado (borda/fundo primários + check).
  final bool selecionado;

  /// Toque no card; nulo deixa o card inativo.
  final VoidCallback? onTap;

  const HorarioCard({
    super.key,
    required this.de,
    required this.ate,
    this.selecionado = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final duracao = duracaoHorario(de, ate);
    final faixa = faixaHorario(de, ate);
    final destaque = isDark ? const Color(0xFF93B4F8) : AppColors.primary;

    // excludeSemantics descarta a semântica do InkWell (inclusive a ação de
    // toque), então o onTap precisa ser repassado aqui — senão o toque duplo
    // do TalkBack/VoiceOver não faz nada.
    return Semantics(
      container: true,
      button: true,
      enabled: onTap != null,
      selected: selecionado,
      label: duracao.isEmpty ? faixa : '$faixa, duração $duracao',
      onTap: onTap,
      excludeSemantics: true,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        constraints: const BoxConstraints(minHeight: 64),
        decoration: BoxDecoration(
          color: selecionado
              ? AppColors.primary.withValues(alpha: isDark ? 0.18 : 0.06)
              : AppColors.surfaceElevated(context),
          borderRadius: AppRadius.rlg,
          border: Border.all(
            color: selecionado ? AppColors.primary : AppColors.border(context),
            width: selecionado ? 1.5 : 1,
          ),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            onTap: onTap,
            borderRadius: AppRadius.rlg,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: selecionado
                          ? AppColors.primary
                          : AppColors.primary.withValues(alpha: isDark ? 0.2 : 0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      PhosphorIcons.clock,
                      size: 20,
                      color: selecionado ? Colors.white : destaque,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          faixa,
                          style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600),
                        ),
                        if (duracao.isNotEmpty)
                          Text(duracao, style: AppTypography.caption(context).copyWith(fontSize: 13)),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 180),
                    child: selecionado
                        ? Icon(PhosphorIcons.checkCircleFill,
                            key: const ValueKey('sel'), size: 26, color: destaque)
                        : Icon(PhosphorIcons.circle,
                            key: const ValueKey('nao'), size: 26, color: AppColors.textTertiary(context)),
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
