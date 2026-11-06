import 'package:flutter/material.dart';

/// Sistema de espaçamento (escala de 4px).
class AppSpacing {
  AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;
  static const double huge = 48;

  // SizedBoxes prontos para uso
  static const Widget gapXs = SizedBox(height: xs, width: xs);
  static const Widget gapSm = SizedBox(height: sm, width: sm);
  static const Widget gapMd = SizedBox(height: md, width: md);
  static const Widget gapLg = SizedBox(height: lg, width: lg);
  static const Widget gapXl = SizedBox(height: xl, width: xl);
  static const Widget gapXxl = SizedBox(height: xxl, width: xxl);
  static const Widget gapXxxl = SizedBox(height: xxxl, width: xxxl);
}

/// Cantos do tema: tudo reto. Os degraus antigos valem 0 para quem já os usa;
/// só [tag] e [full] (avatar e ponto) arredondam.
class AppRadius {
  AppRadius._();

  static const double sm = 0;
  static const double md = 0;
  static const double lg = 0;
  static const double xl = 0;
  static const double xxl = 0;
  static const double tag = 2;
  static const double full = 999;

  static BorderRadius rsm = BorderRadius.circular(sm);
  static BorderRadius rmd = BorderRadius.circular(md);
  static BorderRadius rlg = BorderRadius.circular(lg);
  static BorderRadius rxl = BorderRadius.circular(xl);
  static BorderRadius rxxl = BorderRadius.circular(xxl);
}
