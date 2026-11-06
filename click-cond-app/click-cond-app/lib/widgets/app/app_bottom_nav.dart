import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

/// Item da [AppBottomNav].
class AppNavItem {
  final IconData icon;
  final IconData? activeIcon;
  final String label;
  final bool selected;

  /// Botão central sólido (`.nav .c`). Não mostra a barra de selecionado.
  final bool center;
  final VoidCallback onTap;
  final Key? key;

  const AppNavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.activeIcon,
    this.selected = false,
    this.center = false,
    this.key,
  });
}

/// `.nav`: barra inferior `bg-100` com linha no topo, rótulos em caixa alta e
/// barra de 24×2px sobre o item selecionado.
class AppBottomNav extends StatelessWidget {
  final List<AppNavItem> items;

  const AppBottomNav({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.bg100(context),
        border: Border(top: BorderSide(color: AppColors.border(context))),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final item in items)
                Expanded(child: _NavButton(key: item.key, item: item)),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  final AppNavItem item;

  const _NavButton({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    final cor = item.selected
        ? AppColors.textPrimary(context)
        : AppColors.textTertiary(context);
    final icone = item.selected ? (item.activeIcon ?? item.icon) : item.icon;

    return Semantics(
      button: true,
      selected: item.selected,
      label: item.label,
      excludeSemantics: true,
      child: InkWell(
        onTap: item.onTap,
        child: item.center
            ? Center(
                child: Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  color: AppColors.accent(context),
                  child: Icon(icone, size: 20, color: AppColors.onAccent(context)),
                ),
              )
            : Column(
                children: [
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeOut,
                    width: item.selected ? 24 : 0,
                    height: 2,
                    color: AppColors.accent(context),
                  ),
                  const SizedBox(height: 8),
                  Icon(icone, size: 20, color: cor),
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        item.label.toUpperCase(),
                        maxLines: 1,
                        style: AppTypography.label(context).copyWith(
                          color: cor,
                          fontSize: 10,
                          letterSpacing: 10 * 0.16,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
