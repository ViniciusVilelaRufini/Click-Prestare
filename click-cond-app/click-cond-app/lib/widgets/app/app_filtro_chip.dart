import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

/// Filtro padrão do app (mês, tipo, situação…): rótulo curto em caixa alta,
/// fundo da marca quando ativo e só contorno quando não. É o desenho dos
/// filtros "NO LOCAL / CADASTRADOS" de Visitantes e do filtro de mês de
/// Ocorrências — use este widget em vez de recriar o estilo em cada tela.
class AppFiltroChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  /// Ícone opcional à esquerda do rótulo.
  final IconData? icon;

  const AppFiltroChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final cor = selected ? AppColors.onBrand : AppColors.textSecondary(context);
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? AppColors.brand : Colors.transparent,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: selected ? AppColors.brand : AppColors.borderStrong(context)),
        ),
        child: InkWell(
          onTap: onTap,
          child: Container(
            height: 34,
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 16, color: cor),
                  const SizedBox(width: 6),
                ],
                Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  style: AppTypography.label(context).copyWith(color: cor),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
