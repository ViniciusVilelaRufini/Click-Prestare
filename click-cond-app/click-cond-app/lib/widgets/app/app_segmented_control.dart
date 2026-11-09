import 'package:click/theme/app_colors.dart';
import 'package:click/theme/app_typography.dart';
import 'package:flutter/material.dart';

/// Item de um [AppSegmentedControl].
class AppSegment {
  final String label;
  final IconData? icon;
  final int? count;
  const AppSegment({required this.label, this.icon, this.count});
}

/// Abas com sublinhado (`.tabs`). Pode ser usado de forma controlada ([selectedIndex] +
/// [onChanged]) ou ligado ao [TabController] mais próximo com
/// [AppSegmentedControl.tabs], mantendo o gesto de arrastar do `TabBarView`.
class AppSegmentedControl extends StatelessWidget {
  final List<AppSegment> segments;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  /// Abas com a largura do próprio rótulo e rolagem lateral, para quando são
  /// muitas (Notificações tem 5 com contador) e não cabem em partes iguais.
  final bool scrollable;

  const AppSegmentedControl({
    super.key,
    required this.segments,
    required this.selectedIndex,
    required this.onChanged,
    this.scrollable = false,
  });

  /// Versão ligada ao `DefaultTabController`/`TabController` do contexto.
  static Widget tabs({Key? key, required List<AppSegment> segments}) =>
      _TabBoundSegmentedControl(key: key, segments: segments);

  @override
  Widget build(BuildContext context) {
    final abas = Row(
      children: [
        for (var i = 0; i < segments.length; i++)
          _SegmentItem(
            segment: segments[i],
            selected: i == selectedIndex,
            compact: segments.length >= 3,
            natural: scrollable,
            onTap: () => onChanged(i),
          ),
      ],
    );
    return Container(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.border(context))),
      ),
      child: scrollable
          ? SingleChildScrollView(scrollDirection: Axis.horizontal, child: abas)
          : abas,
    );
  }
}

class _SegmentItem extends StatelessWidget {
  final AppSegment segment;
  final bool selected;
  final VoidCallback onTap;

  /// Com 3+ segmentos o respiro lateral diminui para o rótulo caber.
  final bool compact;

  /// Largura do próprio rótulo, sem encolher o texto (modo com rolagem).
  final bool natural;
  const _SegmentItem({
    required this.segment,
    required this.selected,
    required this.onTap,
    this.compact = false,
    this.natural = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected
        ? AppColors.textPrimary(context)
        : AppColors.textTertiary(context);
    final label = segment.count == null
        ? segment.label
        : '${segment.label} (${segment.count})';
    final texto = Text(
      label.toUpperCase(),
      maxLines: 1,
      style: AppTypography.label(context).copyWith(
        color: color,
        letterSpacing: 11 * 0.18,
      ),
    );
    final aba = Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          constraints: const BoxConstraints(minHeight: 44),
          alignment: Alignment.center,
          padding: EdgeInsets.symmetric(
            vertical: 10,
            horizontal: natural ? 16 : (compact ? 4 : 8),
          ),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color:
                    selected ? AppColors.brandOf(context) : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (segment.icon != null) ...[
                Icon(segment.icon, size: 15, color: color),
                const SizedBox(width: 6),
              ],
              // FittedBox: em telas estreitas o rótulo encolhe um pouco
              // em vez de virar "AGUARDANDO …". Com rolagem não precisa.
              if (natural)
                texto
              else
                Flexible(
                  child: FittedBox(fit: BoxFit.scaleDown, child: texto),
                ),
            ],
          ),
        ),
      ),
    );
    return natural ? aba : Expanded(child: aba);
  }
}

class _TabBoundSegmentedControl extends StatefulWidget {
  final List<AppSegment> segments;
  const _TabBoundSegmentedControl({super.key, required this.segments});

  @override
  State<_TabBoundSegmentedControl> createState() =>
      _TabBoundSegmentedControlState();
}

class _TabBoundSegmentedControlState extends State<_TabBoundSegmentedControl> {
  TabController? _controller;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final next = DefaultTabController.maybeOf(context);
    if (next == _controller) return;
    _controller?.animation?.removeListener(_onTick);
    _controller = next;
    _controller?.animation?.addListener(_onTick);
  }

  @override
  void dispose() {
    _controller?.animation?.removeListener(_onTick);
    super.dispose();
  }

  void _onTick() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    // Acompanha o arrasto do TabBarView: o índice muda na metade do caminho.
    final index = controller == null
        ? 0
        : (controller.animation?.value ?? controller.index.toDouble()).round();
    return AppSegmentedControl(
      segments: widget.segments,
      selectedIndex: index,
      onChanged: (i) => controller?.animateTo(i),
    );
  }
}
