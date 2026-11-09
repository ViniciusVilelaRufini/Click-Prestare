import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Tipografia do tema Prestare Dark.
///
/// Barlow Condensed para estrutura e Barlow para conteúdo. O `TextStyle` não
/// muda a caixa: nos estilos de estrutura, chame `toUpperCase()` no ponto de
/// exibição, nunca na tradução.
class AppTypography {
  AppTypography._();

  static TextStyle _estrutura(
    BuildContext c, {
    required double size,
    required double line,
    required double spacing,
    FontWeight weight = FontWeight.w600,
    Color? color,
  }) =>
      GoogleFonts.barlowCondensed(
        fontSize: size,
        height: line / size,
        letterSpacing: size * spacing,
        fontWeight: weight,
        color: color ?? AppColors.textPrimary(c),
      );

  static TextStyle _conteudo(
    double size,
    double line,
    FontWeight weight,
    Color color,
  ) =>
      GoogleFonts.barlow(
        fontSize: size,
        height: line / size,
        fontWeight: weight,
        color: color,
      );

  // ── Estrutura
  /// `.hero`, 40/40 +0.04em. Abertura de tela.
  static TextStyle display(BuildContext c) =>
      _estrutura(c, size: 40, line: 40, spacing: 0.04);

  /// `.title`, 22/26 +0.1em. Título de tela.
  static TextStyle title(BuildContext c) =>
      _estrutura(c, size: 22, line: 26, spacing: 0.1);

  /// `.section`, 15/20 +0.16em. Título de seção.
  static TextStyle section(BuildContext c) =>
      _estrutura(c, size: 15, line: 20, spacing: 0.16);

  /// Nome antigo de [section].
  static TextStyle headline(BuildContext c) => section(c);

  /// `.label`, 11/14 +0.2em. Rótulo.
  static TextStyle label(BuildContext c) => _estrutura(
        c,
        size: 11,
        line: 14,
        spacing: 0.2,
        color: AppColors.textTertiary(c),
      );

  /// `.num`, peso 300, 34/36 +0.02em. Numeral de KPI, com algarismos tabulares.
  static TextStyle numeral(BuildContext c) => _estrutura(
        c,
        size: 34,
        line: 36,
        spacing: 0.02,
        weight: FontWeight.w300,
      ).copyWith(fontFeatures: const [FontFeature.tabularFigures()]);

  /// `.btn`, 13 +0.2em, na cor `on-accent`.
  static TextStyle button(BuildContext c) => _estrutura(
        c,
        size: 13,
        line: 16,
        spacing: 0.14,
        color: AppColors.onAccent(c),
      );

  // ── Conteúdo
  /// `.strong`, 16/22 peso 500.
  static TextStyle strong(BuildContext c) =>
      _conteudo(16, 22, FontWeight.w500, AppColors.textPrimary(c));

  /// Nome antigo de [strong].
  static TextStyle bodyMedium(BuildContext c) => strong(c);

  /// 16/22 peso 400: texto corrido e campos.
  static TextStyle body(BuildContext c) =>
      _conteudo(16, 22, FontWeight.w400, AppColors.textPrimary(c));

  /// `.body`, 14/20 em `ink-muted`.
  static TextStyle bodySecondary(BuildContext c) =>
      _conteudo(14, 20, FontWeight.w400, AppColors.textSecondary(c));

  /// `.body`, 14/20 em `ink-muted`.
  static TextStyle caption(BuildContext c) => bodySecondary(c);

  /// 14/20 peso 500 em `ink`.
  static TextStyle captionMedium(BuildContext c) =>
      _conteudo(14, 20, FontWeight.w500, AppColors.textPrimary(c));

  /// `.cap`, 12/16 em `ink-subtle`.
  static TextStyle tiny(BuildContext c) =>
      _conteudo(12, 16, FontWeight.w400, AppColors.textTertiary(c));
}
