import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// Item de um [AppSegmentedControl].
class AppSegment {
  final String label;
  final IconData? icon;
  final int? count;
  const AppSegment({required this.label, this.icon, this.count});
}

/// Controle segmentado em pílula (mesmo desenho do seletor "Meu financeiro /
/// Condomínio"). Pode ser usado de forma controlada ([selectedIndex] +
/// [onChanged]) ou ligado ao [TabController] mais próximo com
/// [AppSegmentedControl.tabs], mantendo o gesto de arrastar do `TabBarView`.
class AppSegmentedControl extends StatelessWidget {
  final List<AppSegment> segments;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  const AppSegmentedControl({
    super.key,
    required this.segments,
    required this.selectedIndex,
    required this.onChanged,
  });

  /// Versão ligada ao `DefaultTabController`/`TabController` do contexto.
  static Widget tabs({Key? key, required List<AppSegment> segments}) =>
      _TabBoundSegmentedControl(key: key, segments: segments);

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated(context),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border(context)),
        boxShadow: [
          BoxShadow(
            color: isDark
                ? Colors.black.withValues(alpha: 0.2)
                : const Color(0xFF64748B).withValues(alpha: 0.06),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          for (var i = 0; i < segments.length; i++) ...[
            if (i > 0) const SizedBox(width: 4),
            _SegmentItem(
              segment: segments[i],
              selected: i == selectedIndex,
              compact: segments.length >= 3,
              onTap: () => onChanged(i),
            ),
          ],
        ],
      ),
    );
  }
}

class _SegmentItem extends StatelessWidget {
  final AppSegment segment;
  final bool selected;
  final VoidCallback onTap;

  /// Com 3+ segmentos o respiro lateral diminui para o rótulo caber.
  final bool compact;
  const _SegmentItem({
    required this.segment,
    required this.selected,
    required this.onTap,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected ? Colors.white : AppColors.textSecondary(context);
    final label = segment.count == null ? segment.label : '${segment.label} (${segment.count})';
    return Expanded(
      child: Semantics(
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
            padding: EdgeInsets.symmetric(vertical: 10, horizontal: compact ? 4 : 8),
            decoration: BoxDecoration(
              color: selected ? AppColors.primary : Colors.transparent,
              borderRadius: BorderRadius.circular(14),
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
                // em vez de virar "AGUARDANDO …".
                Flexible(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      label.toUpperCase(),
                      maxLines: 1,
                      style: TextStyle(
                        color: color,
                        fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                        letterSpacing: 0.6,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TabBoundSegmentedControl extends StatefulWidget {
  final List<AppSegment> segments;
  const _TabBoundSegmentedControl({super.key, required this.segments});

  @override
  State<_TabBoundSegmentedControl> createState() => _TabBoundSegmentedControlState();
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
