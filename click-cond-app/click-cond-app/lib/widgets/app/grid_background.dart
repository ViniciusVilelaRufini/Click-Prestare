import 'package:flutter/material.dart';

/// Malha quadriculada sutil usada como textura de fundo das telas.
///
/// Fica atrás do conteúdo (use dentro de um `Stack` com `Positioned.fill`) e
/// não intercepta toques.
class GridBackground extends StatelessWidget {
  const GridBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: CustomPaint(painter: GridPainter(context)),
    );
  }
}

class GridPainter extends CustomPainter {
  final BuildContext context;
  GridPainter(this.context);

  @override
  void paint(Canvas canvas, Size size) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    // No escuro a malha é subtrativa: linha branca, mesmo a 2%, deixa um véu
    // que lava o navy do fundo e puxa a tela para um cinza esverdeado —
    // destoando das telas sem grid, que ficam no azul escuro cheio.
    final paint = Paint()
      ..color = Colors.black.withValues(alpha: isDark ? 0.22 : 0.025)
      ..strokeWidth = 0.8;

    const double step = 38.0;

    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
