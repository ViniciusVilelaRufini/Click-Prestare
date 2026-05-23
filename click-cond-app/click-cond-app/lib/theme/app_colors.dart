import 'package:flutter/material.dart';

/// Sistema de cores do app — tema modernizado, mantendo identidade azul.
class AppColors {
  AppColors._();

  // ── Primário (azul Click corporativo, igual ao web)
  static const Color primary = Color(0xFF2563EB);
  static const Color primaryDark = Color(0xFF1D4ED8);
  static const Color primaryLight = Color(0xFFEFF6FF);
  static const Color primaryGradientStart = Color(0xFF2563EB);
  static const Color primaryGradientEnd = Color(0xFF1D4ED8);

  // ── Semânticos
  static const Color success = Color(0xFF00C896);
  static const Color warning = Color(0xFFFFB020);
  static const Color error = Color(0xFFF4445E);
  static const Color info = Color(0xFF2563EB);

  // ── Modo CLARO
  static const Color lightBg = Color(0xFFFFFFFF);
  static const Color lightSurface = Color(0xFFF7F8FA);
  static const Color lightSurfaceElevated = Color(0xFFFFFFFF);
  static const Color lightBorder = Color(0xFFEAECEF);
  static const Color lightTextPrimary = Color(0xFF0A1628);
  static const Color lightTextSecondary = Color(0xFF5A6677);
  static const Color lightTextTertiary = Color(0xFF98A2B3);

  // ── Modo ESCURO
  static const Color darkBg = Color(0xFF0A1628);
  static const Color darkSurface = Color(0xFF131D2E);
  static const Color darkSurfaceElevated = Color(0xFF1B2638);
  static const Color darkBorder = Color(0xFF1F2A3D);
  static const Color darkTextPrimary = Color(0xFFF7F8FA);
  static const Color darkTextSecondary = Color(0xFF98A2B3);
  static const Color darkTextTertiary = Color(0xFF5A6677);

  // ── Helpers contextuais
  static Color bg(BuildContext c) => _isDark(c) ? darkBg : lightBg;
  static Color surface(BuildContext c) => _isDark(c) ? darkSurface : lightSurface;
  static Color surfaceElevated(BuildContext c) =>
      _isDark(c) ? darkSurfaceElevated : lightSurfaceElevated;
  static Color border(BuildContext c) => _isDark(c) ? darkBorder : lightBorder;
  static Color textPrimary(BuildContext c) =>
      _isDark(c) ? darkTextPrimary : lightTextPrimary;
  static Color textSecondary(BuildContext c) =>
      _isDark(c) ? darkTextSecondary : lightTextSecondary;
  static Color textTertiary(BuildContext c) =>
      _isDark(c) ? darkTextTertiary : lightTextTertiary;

  static Color skeletonBase(BuildContext c) =>
      _isDark(c) ? const Color(0xFF1B2638) : Colors.grey[300]!;
  static Color skeletonHighlight(BuildContext c) =>
      _isDark(c) ? const Color(0xFF253147) : Colors.grey[100]!;

  static bool _isDark(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark;
}
