import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/rotulo_bloco.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'reserva_helpers.dart';

/// Card "Resumo da reserva": área, data por extenso, horário + duração,
/// convidados e (se informados) bloco/apto. Textos vêm de [resumoReserva].
class ResumoReserva extends StatelessWidget {
  /// Nome da área social.
  final String area;

  /// Data no formato `'dd/MM/yyyy'`.
  final String data;

  /// Horário no formato de `new_reserva.dart`: `'10:00 - 16:00'`.
  final String horario;

  /// Convidados; nulo/0 = "Sem convidados informados".
  final int? convidados;

  /// Bloco da unidade (opcional; a linha só aparece com bloco ou apto).
  final String? bloco;

  /// Apartamento (opcional).
  final String? apto;

  const ResumoReserva({
    super.key,
    required this.area,
    required this.data,
    required this.horario,
    this.convidados,
    this.bloco,
    this.apto,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final r = resumoReserva(data, horario, convidados);
    final horarioTexto = [r.horario, r.duracao].where((s) => s.isNotEmpty).join(' · ');
    final b = rotuloBloco(bloco);
    final a = (apto ?? '').trim();
    final unidade = [if (b.isNotEmpty) b, if (a.isNotEmpty) 'Apto $a'].join(' · ');
    final destaque = isDark ? const Color(0xFF93B4F8) : AppColors.primary;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: isDark ? 0.12 : 0.04),
        borderRadius: AppRadius.rlg,
        border: Border.all(color: AppColors.primary.withValues(alpha: isDark ? 0.4 : 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(PhosphorIcons.calendarCheck, size: 20, color: destaque),
              const SizedBox(width: AppSpacing.sm),
              Text(
                'Resumo da reserva',
                style: AppTypography.captionMedium(context).copyWith(color: destaque, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _Linha(icone: PhosphorIcons.mapPin, texto: area, forte: true),
          _Linha(icone: PhosphorIcons.calendarBlank, texto: r.dataExtenso),
          if (horarioTexto.isNotEmpty) _Linha(icone: PhosphorIcons.clock, texto: horarioTexto),
          _Linha(
            icone: PhosphorIcons.users,
            texto: r.convidados,
            apagado: r.quantidadeConvidados == null,
          ),
          if (unidade.isNotEmpty) _Linha(icone: PhosphorIcons.house, texto: unidade),
        ],
      ),
    );
  }
}

class _Linha extends StatelessWidget {
  final IconData icone;
  final String texto;
  final bool forte;
  final bool apagado;

  const _Linha({required this.icone, required this.texto, this.forte = false, this.apagado = false});

  @override
  Widget build(BuildContext context) {
    final estilo = forte
        ? AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600)
        : AppTypography.body(context).copyWith(
            fontSize: 15,
            color: apagado ? AppColors.textSecondary(context) : AppColors.textPrimary(context),
          );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icone, size: 18, color: AppColors.textSecondary(context)),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(child: Text(texto, style: estilo)),
        ],
      ),
    );
  }
}
