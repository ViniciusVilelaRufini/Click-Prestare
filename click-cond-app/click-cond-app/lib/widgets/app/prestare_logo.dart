import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';

/// Marca da Prestare: contorno na cor do texto e janelas na cor de marca.
class PrestareLogo extends StatelessWidget {
  final double height;
  final Color color;

  const PrestareLogo({super.key, required this.height, required this.color});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Image.asset(
          'assets/images/logo_prestare_contorno.png',
          height: height,
          color: color,
          colorBlendMode: BlendMode.srcIn,
          fit: BoxFit.contain,
        ),
        Image.asset(
          'assets/images/logo_prestare_janelas.png',
          height: height,
          color: AppColors.brand,
          colorBlendMode: BlendMode.srcIn,
          fit: BoxFit.contain,
        ),
      ],
    );
  }
}
