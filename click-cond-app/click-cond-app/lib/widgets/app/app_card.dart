import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_spacing.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// `.card`: fundo `bg-200`, contorno `line-100`.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final conteudo = Padding(padding: padding, child: child);
    return Material(
      color: AppColors.surface(context),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: AppColors.border(context)),
      ),
      child: onTap == null ? conteudo : InkWell(onTap: onTap, child: conteudo),
    );
  }
}

/// `.list`: itens colados, separados por uma linha de 1px.
class AppList extends StatelessWidget {
  final List<Widget> children;

  const AppList({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    final linha = AppColors.border(context);
    return Container(
      decoration: BoxDecoration(color: linha, border: Border.all(color: linha)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) const SizedBox(height: 1),
            children[i],
          ],
        ],
      ),
    );
  }
}

/// `.item`: linha de lista com ícone ou avatar, título, apoio e seta se tocável.
class AppListItem extends StatelessWidget {
  final Widget? leading;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  const AppListItem({
    super.key,
    required this.title,
    this.leading,
    this.subtitle,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final fim = trailing ??
        (onTap == null
            ? null
            : Icon(
                PhosphorIcons.caretRight,
                size: 18,
                color: AppColors.textTertiary(context),
              ));
    final conteudo = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 14)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.strong(context),
                ),
                if (subtitle != null)
                  Text(
                    subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.tiny(context),
                  ),
              ],
            ),
          ),
          if (fim != null) ...[const SizedBox(width: 14), fim],
        ],
      ),
    );
    return Material(
      color: AppColors.surface(context),
      child: onTap == null ? conteudo : InkWell(onTap: onTap, child: conteudo),
    );
  }
}

/// `.ico`: quadrado `brand-soft` com ícone `brand-ink`. [color] só para sinal.
class AppIconBox extends StatelessWidget {
  final IconData icon;
  final double size;
  final double iconSize;
  final Color? color;

  const AppIconBox({
    super.key,
    required this.icon,
    this.size = 40,
    this.iconSize = 18,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      color: AppColors.brandSoftOf(context),
      child: Icon(
        icon,
        size: iconSize,
        color: color ?? AppColors.brandInkOf(context),
      ),
    );
  }
}

/// `.avatar`: círculo com iniciais em caixa alta, ou [image] por cima delas.
class AppAvatar extends StatelessWidget {
  final String initials;
  final ImageProvider? image;
  final double size;

  const AppAvatar({
    super.key,
    this.initials = '',
    this.image,
    this.size = 44,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.surfaceElevated(context),
        border: Border.all(color: AppColors.borderStrong(context)),
        image: image == null
            ? null
            : DecorationImage(image: image!, fit: BoxFit.cover),
      ),
      child: image != null
          ? null
          : Text(
              initials.toUpperCase(),
              style: AppTypography.section(context).copyWith(
                fontSize: 14,
                letterSpacing: 14 * 0.08,
              ),
            ),
    );
  }
}

/// `.kpis`: grade de duas colunas separada por linhas de 1px.
class AppKpiGrid extends StatelessWidget {
  final List<AppKpi> children;

  const AppKpiGrid({super.key, required this.children});

  @override
  Widget build(BuildContext context) {
    final linha = AppColors.border(context);
    final linhas = <Widget>[];
    for (var i = 0; i < children.length; i += 2) {
      if (i > 0) linhas.add(const SizedBox(height: 1));
      linhas.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: children[i]),
              const SizedBox(width: 1),
              Expanded(
                child: i + 1 < children.length
                    ? children[i + 1]
                    : ColoredBox(color: AppColors.surface(context)),
              ),
            ],
          ),
        ),
      );
    }
    return Container(
      decoration: BoxDecoration(color: linha, border: Border.all(color: linha)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: linhas,
      ),
    );
  }
}

/// `.kpi`: rótulo em caixa alta sobre numeral.
class AppKpi extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final VoidCallback? onTap;

  const AppKpi({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final conteudo = Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: AppTypography.label(context)),
          const SizedBox(height: 6),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              maxLines: 1,
              softWrap: false,
              style: AppTypography.numeral(context).copyWith(color: valueColor),
            ),
          ),
        ],
      ),
    );
    return Material(
      color: AppColors.surface(context),
      child: onTap == null ? conteudo : InkWell(onTap: onTap, child: conteudo),
    );
  }
}

/// `.total-card`: borda de marca, faixa de 3px no topo e fundo em degradê. Para
/// o número principal de uma tela financeira.
BoxDecoration cartaoDestaque(BuildContext context) {
  return BoxDecoration(
    gradient: LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [
        Color.alphaBlend(AppColors.brandSoft, AppColors.surface(context)),
        AppColors.surface(context),
      ],
      stops: const [0, 0.6],
    ),
    border: Border(
      top: BorderSide(color: AppColors.brand, width: 3),
      left: BorderSide(color: AppColors.brand),
      right: BorderSide(color: AppColors.brand),
      bottom: BorderSide(color: AppColors.brand),
    ),
  );
}
