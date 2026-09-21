import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:click/theme/app_typography.dart';

class SwipeAction {
  final IconData icon;
  final String label;
  final Color backgroundColor;
  final Color foregroundColor;
  final VoidCallback onTap;

  const SwipeAction({
    required this.icon,
    required this.label,
    required this.backgroundColor,
    this.foregroundColor = Colors.white,
    required this.onTap,
  });
}

class SwipeableActionCard extends StatefulWidget {
  final Widget child;
  final List<SwipeAction> actions;
  final double actionWidth;
  final double borderRadius;
  final VoidCallback? onTap;

  const SwipeableActionCard({
    super.key,
    required this.child,
    required this.actions,
    this.actionWidth = 72.0,
    this.borderRadius = 16.0,
    this.onTap,
  });

  @override
  State<SwipeableActionCard> createState() => SwipeableActionCardState();
}

class SwipeableActionCardState extends State<SwipeableActionCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  double _dragExtent = 0.0;
  bool _isOpen = false;

  double get _maxExtent => widget.actions.length * widget.actionWidth;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 220),
    )..addListener(() {
        setState(() {
          _dragExtent = _animation.value;
        });
      });
    _animation = Tween<double>(begin: 0.0, end: 0.0).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void open() {
    if (_maxExtent == 0) return;
    _animation = Tween<double>(begin: _dragExtent, end: _maxExtent).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );
    _controller.forward(from: 0.0).then((_) {
      if (mounted) {
        _isOpen = true;
        HapticFeedback.lightImpact();
      }
    });
  }

  void close() {
    if (_dragExtent == 0) return;
    _animation = Tween<double>(begin: _dragExtent, end: 0.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic),
    );
    _controller.forward(from: 0.0).then((_) {
      if (mounted) _isOpen = false;
    });
  }

  void _handleDragUpdate(DragUpdateDetails details) {
    if (widget.actions.isEmpty) return;
    setState(() {
      _dragExtent -= details.primaryDelta ?? 0.0;
      if (_dragExtent < 0) {
        _dragExtent = 0;
      } else if (_dragExtent > _maxExtent) {
        final over = _dragExtent - _maxExtent;
        _dragExtent = _maxExtent + (over * 0.25);
      }
    });
  }

  void _handleDragEnd(DragEndDetails details) {
    if (widget.actions.isEmpty) return;
    final velocity = details.primaryVelocity ?? 0.0;
    if (velocity < -300) {
      open();
    } else if (velocity > 300) {
      close();
    } else {
      if (_dragExtent > _maxExtent * 0.4) {
        open();
      } else {
        close();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.actions.isEmpty) {
      return widget.child;
    }

    final actionsWidth = _dragExtent > _maxExtent ? _dragExtent : _maxExtent;

    return ClipRRect(
      borderRadius: BorderRadius.circular(widget.borderRadius),
      child: Stack(
        children: [
          // Ações no fundo alinhadas à direita
          Positioned(
            top: 0,
            bottom: 0,
            right: 0,
            width: actionsWidth,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: widget.actions.map((action) {
                return Expanded(
                  child: Material(
                    color: action.backgroundColor,
                    child: InkWell(
                      onTap: () {
                        close();
                        action.onTap();
                      },
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            action.icon,
                            color: action.foregroundColor,
                            size: 20,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            action.label,
                            style: AppTypography.caption(context).copyWith(
                              color: action.foregroundColor,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          // Conteúdo do Card que desliza
          Transform.translate(
            offset: Offset(-_dragExtent, 0),
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onHorizontalDragUpdate: _handleDragUpdate,
              onHorizontalDragEnd: _handleDragEnd,
              onTap: () {
                if (_dragExtent > 5.0 || _isOpen) {
                  close();
                } else {
                  widget.onTap?.call();
                }
              },
              child: widget.child,
            ),
          ),
        ],
      ),
    );
  }
}
