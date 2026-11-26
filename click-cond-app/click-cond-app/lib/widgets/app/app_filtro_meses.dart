import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/widgets/app/app_filtro_chip.dart';
import 'package:flutter/material.dart';

const _mesesPt = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

/// Rótulo "Janeiro / 2026" dos chips de mês.
String rotuloMesFiltro(DateTime d) => '${_mesesPt[d.month - 1]} / ${d.year}';

/// Os últimos [quantidade] meses, do atual para trás (dia 1).
List<DateTime> ultimosMeses({int quantidade = 12, DateTime? agora}) {
  final now = agora ?? DateTime.now();
  return [for (var i = 0; i < quantidade; i++) DateTime(now.year, now.month - i, 1)];
}

/// Filtro de mês padrão do app: "Todos os meses" + últimos 12 meses, em
/// [AppFiltroChip]. É a mesma faixa de Ocorrências; [selecionado] nulo = todos.
class AppFiltroMeses extends StatelessWidget {
  final DateTime? selecionado;
  final ValueChanged<DateTime?> onChanged;
  final DateTime? agora;

  const AppFiltroMeses({super.key, required this.selecionado, required this.onChanged, this.agora});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 52,
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: AppColors.textTertiary(context).withValues(alpha: 0.08), width: 1),
        ),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        children: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.sm),
            child: AppFiltroChip(
              label: 'Todos os meses',
              selected: selecionado == null,
              onTap: () => onChanged(null),
            ),
          ),
          for (final m in ultimosMeses(agora: agora))
            Padding(
              padding: const EdgeInsets.only(right: AppSpacing.sm),
              child: Builder(builder: (_) {
                final sel = selecionado != null && selecionado!.month == m.month && selecionado!.year == m.year;
                return AppFiltroChip(
                  label: rotuloMesFiltro(m),
                  selected: sel,
                  onTap: () => onChanged(sel ? null : m),
                );
              }),
            ),
        ],
      ),
    );
  }
}
