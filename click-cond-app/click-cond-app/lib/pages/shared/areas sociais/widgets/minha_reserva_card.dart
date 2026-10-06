import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:click/utils/rotulo_bloco.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'reserva_helpers.dart';
import 'reserva_status_badge.dart';

/// Card de uma reserva na tela de detalhe da área: selo de data à esquerda
/// (dia da semana, dia, mês), faixa de horário + duração, convidados, selo de
/// status e — quando [onEditar] é dado — o botão "Editar" (o card inteiro
/// também fica tocável).
class MinhaReservaCard extends StatelessWidget {
  /// Chave do botão "Editar" (para testes e para localizar o alvo de toque).
  static const chaveEditar = Key('minha-reserva-editar');

  /// Item de `area['agendamentos']`: `data` (dd/MM/yyyy), `horaDe`, `horaAte`,
  /// `status`, `convidados`, `bloco`, `apto`.
  final dynamic reserva;

  /// Ação de editar; nulo esconde o botão e deixa o card não tocável.
  final VoidCallback? onEditar;

  /// Mostra "Bloco X · Apto Y" (síndico/funcionário veem reservas de todos).
  final bool mostrarApto;

  const MinhaReservaCard({
    super.key,
    required this.reserva,
    this.onEditar,
    this.mostrarApto = false,
  });

  String _campo(String k) {
    final v = reserva is Map ? reserva[k] : null;
    final s = (v ?? '').toString().trim();
    return s == 'null' ? '' : s;
  }

  @override
  Widget build(BuildContext context) {
    final dataTexto = _campo('data');
    final data = parseDataReserva(dataTexto);
    final de = _campo('horaDe');
    final ate = _campo('horaAte');
    final faixa = de.isNotEmpty && ate.isNotEmpty ? faixaHorario(de, ate) : de;
    final duracao = duracaoHorario(de, ate);
    final convidados = convidadosDaReserva(reserva is Map ? reserva['convidados'] : null);
    final bloco = rotuloBloco(_campo('bloco'));
    final apto = _campo('apto');
    final unidade = [if (bloco.isNotEmpty) bloco, if (apto.isNotEmpty) 'Apto $apto'].join(' · ');

    final secundario = AppTypography.caption(context).copyWith(fontSize: 13);

    Widget info(IconData icone, String texto) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icone, size: 15, color: AppColors.textTertiary(context)),
            const SizedBox(width: AppSpacing.xs),
            Flexible(child: Text(texto, style: secundario, maxLines: 1, overflow: TextOverflow.ellipsis)),
          ],
        );

    return Material(
      color: AppColors.surfaceElevated(context),
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.rlg,
        side: BorderSide(color: AppColors.border(context)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onEditar,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _SeloData(data: data, dataTexto: dataTexto),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                faixa.isNotEmpty ? faixa : dataTexto,
                                style: AppTypography.bodyMedium(context).copyWith(fontWeight: FontWeight.w600),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            // Teto de largura: status desconhecido (texto livre
                            // da API) não empurra o horário para fora da tela.
                            ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 132),
                              child: ReservaStatusBadge(status: _campo('status')),
                            ),
                          ],
                        ),
                        const SizedBox(height: AppSpacing.xs),
                        Wrap(
                          spacing: AppSpacing.md,
                          runSpacing: AppSpacing.xs,
                          children: [
                            if (data == null && dataTexto.isNotEmpty && faixa.isNotEmpty)
                              info(PhosphorIcons.calendarBlank, dataTexto),
                            if (duracao.isNotEmpty) info(PhosphorIcons.clock, duracao),
                            if (convidados != null)
                              info(PhosphorIcons.users, convidados == 1 ? '1 convidado' : '$convidados convidados'),
                            if (mostrarApto && unidade.isNotEmpty) info(PhosphorIcons.house, unidade),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (onEditar != null) ...[
                const SizedBox(height: AppSpacing.sm),
                Divider(height: 1, color: AppColors.border(context)),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    key: chaveEditar,
                    onPressed: onEditar,
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      minimumSize: const Size(48, 48),
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
                      shape: RoundedRectangleBorder(borderRadius: AppRadius.rmd),
                    ),
                    icon: const Icon(PhosphorIcons.pencilSimple, size: 18),
                    label: Text(
                      'Editar',
                      style: AppTypography.captionMedium(context).copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Bloco de data "DOM / 11 / OUT" tingido com a cor primária.
class _SeloData extends StatelessWidget {
  final DateTime? data;
  final String dataTexto;

  const _SeloData({required this.data, required this.dataTexto});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final fg = isDark ? const Color(0xFF93B4F8) : AppColors.primaryDark;
    final d = data;

    return Semantics(
      label: d == null ? dataTexto : dataPorExtenso(dataTexto),
      excludeSemantics: true,
      child: Container(
        width: 56,
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: isDark ? 0.2 : 0.08),
          borderRadius: AppRadius.rmd,
        ),
        child: d == null
            ? Icon(PhosphorIcons.calendarBlank, color: fg, size: 24)
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(diasSemanaAbreviados[d.weekday - 1],
                      style: AppTypography.tiny(context).copyWith(color: fg, fontSize: 10, letterSpacing: 0.6)),
                  Text('${d.day}',
                      style: AppTypography.headline(context)
                          .copyWith(color: fg, fontWeight: FontWeight.w700, height: 1.15)),
                  Text(mesesAbreviados[d.month - 1],
                      style: AppTypography.tiny(context).copyWith(color: fg, fontSize: 10, letterSpacing: 0.6)),
                ],
              ),
      ),
    );
  }
}
