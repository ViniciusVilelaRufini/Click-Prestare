import 'package:flutter/material.dart';

/// A malha quadriculada saiu com o tema Prestare Dark, que não tem textura. Fica
/// vazia para as telas que ainda a colocam no `Stack`.
class GridBackground extends StatelessWidget {
  const GridBackground({super.key});

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
