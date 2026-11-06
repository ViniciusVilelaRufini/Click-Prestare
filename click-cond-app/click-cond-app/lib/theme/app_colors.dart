import 'dart:ui' show PlatformDispatcher;

import 'package:click/theme/theme_controller.dart';
import 'package:flutter/material.dart';

/// Tokens do tema Prestare Dark: preto e branco, cor só para sinalizar.
///
/// Há três formas de ler uma cor:
/// - constantes `dark*`/`light*`: o valor bruto de cada tema, usado para montar
///   o `ThemeData`;
/// - helpers com `BuildContext` (`surface(c)`, `border(c)`...): preferidos em
///   código novo, porque seguem o `Theme` da árvore;
/// - getters sem contexto (`primary`, `onPrimary`, `error`...): leem o brilho
///   atual em [brightness]. Não são `const`, então não cabem em expressão
///   `const` nem em valor padrão de parâmetro.
class AppColors {
  AppColors._();

  // ── Tema ESCURO
  static const Color darkBg = Color(0xFF000000); // bg-000
  static const Color darkBg100 = Color(0xFF0B0B0B); // bg-100
  static const Color darkSurface = Color(0xFF141414); // bg-200
  static const Color darkSurfaceElevated = Color(0xFF1F1F1F); // bg-300
  static const Color darkBorder = Color(0xFF242424); // line-100
  static const Color darkBorderStrong = Color(0xFF666666); // line-200
  static const Color darkTextPrimary = Color(0xFFFFFFFF); // ink
  static const Color darkTextSecondary = Color(0xFFA3A3A3); // ink-muted
  static const Color darkTextTertiary = Color(0xFF8A8A8A); // ink-subtle
  static const Color darkAccent = Color(0xFFFFFFFF);
  static const Color darkOnAccent = Color(0xFF000000);
  static const Color darkAccentGhost = Color(0x14FFFFFF); // branco a 8%
  static const Color darkSignalOk = Color(0xFF5EC28A);
  static const Color darkSignalWarn = Color(0xFFE3B04B);
  static const Color darkSignalDanger = Color(0xFFFF6B6B);
  static const Color darkScrim = Color(0x99000000); // preto a 60%

  // ── Tema CLARO
  static const Color lightBg = Color(0xFFFFFFFF); // bg-000
  static const Color lightBg100 = Color(0xFFFAFAFA); // bg-100
  static const Color lightSurface = Color(0xFFF4F4F4); // bg-200
  static const Color lightSurfaceElevated = Color(0xFFE9E9E9); // bg-300
  static const Color lightBorder = Color(0xFFE2E2E2); // line-100
  static const Color lightBorderStrong = Color(0xFF888888); // line-200
  static const Color lightTextPrimary = Color(0xFF000000); // ink
  static const Color lightTextSecondary = Color(0xFF555555); // ink-muted
  static const Color lightTextTertiary = Color(0xFF6B6B6B); // ink-subtle
  static const Color lightAccent = Color(0xFF000000);
  static const Color lightOnAccent = Color(0xFFFFFFFF);
  static const Color lightAccentGhost = Color(0x0D000000); // preto a 5%
  static const Color lightSignalOk = Color(0xFF1A7A48);
  static const Color lightSignalWarn = Color(0xFF946000);
  static const Color lightSignalDanger = Color(0xFFC42D33);
  static const Color lightScrim = Color(0x59000000); // preto a 35%

  // ── QR: sempre preto sobre branco, nos dois temas
  static const Color qrInk = Color(0xFF000000);
  static const Color qrPaper = Color(0xFFFFFFFF);

  // ── Brilho atual, sem BuildContext
  /// Brilho em vigor: o modo manual do [ThemeController] ou, em `system`, o do
  /// aparelho. `main.dart` reconstrói a árvore quando ele muda, então quem lê
  /// os getters abaixo no `build` não fica com a cor antiga.
  static Brightness get brightness {
    switch (ThemeController.instance.mode) {
      case ThemeMode.light:
        return Brightness.light;
      case ThemeMode.dark:
        return Brightness.dark;
      case ThemeMode.system:
        return PlatformDispatcher.instance.platformBrightness;
    }
  }

  static bool get _dark => brightness == Brightness.dark;

  // ── Primário: sólido preto ou branco conforme o tema
  static Color get primary => _dark ? darkAccent : lightAccent;

  /// Texto ou ícone sobre [primary] e sobre os sinais usados como fundo.
  static Color get onPrimary => _dark ? darkOnAccent : lightOnAccent;
  static Color get primaryDark => primary;

  /// Preto ou branco legível sobre um fundo [bg] que só se conhece em execução
  /// (cor de status, de categoria). Sobre [primary], use [onPrimary].
  ///
  /// Compara o contraste das duas tintas. `estimateBrightnessForColor` não
  /// serve: ele põe branco sobre `signal-danger` escuro, com contraste 2,8.
  static Color on(Color bg) {
    final luminancia = bg.computeLuminance();
    final contrasteBranco = 1.05 / (luminancia + 0.05);
    final contrastePreto = (luminancia + 0.05) / 0.05;
    return contrasteBranco >= contrastePreto ? Colors.white : Colors.black;
  }

  /// Antigo azul-claro de fundo: agora o `accent-ghost`.
  static Color get primaryLight => _dark ? darkAccentGhost : lightAccentGhost;

  /// Início e fim iguais: os gradientes antigos viram cor sólida.
  static Color get primaryGradientStart => primary;
  static Color get primaryGradientEnd => primary;

  // ── Semânticos
  static Color get success => _dark ? darkSignalOk : lightSignalOk;
  static Color get warning => _dark ? darkSignalWarn : lightSignalWarn;
  static Color get error => _dark ? darkSignalDanger : lightSignalDanger;
  static Color get info => _dark ? darkTextSecondary : lightTextSecondary;

  // ── Helpers contextuais
  static Color bg(BuildContext c) => _isDark(c) ? darkBg : lightBg; // bg-000
  static Color bg100(BuildContext c) =>
      _isDark(c) ? darkBg100 : lightBg100; // barra de navegação, sheet
  static Color surface(BuildContext c) =>
      _isDark(c) ? darkSurface : lightSurface; // bg-200: cartão, campo
  static Color surfaceElevated(BuildContext c) =>
      _isDark(c) ? darkSurfaceElevated : lightSurfaceElevated; // bg-300
  static Color border(BuildContext c) =>
      _isDark(c) ? darkBorder : lightBorder; // line-100
  static Color borderStrong(BuildContext c) =>
      _isDark(c) ? darkBorderStrong : lightBorderStrong; // line-200
  static Color textPrimary(BuildContext c) =>
      _isDark(c) ? darkTextPrimary : lightTextPrimary; // ink
  static Color textSecondary(BuildContext c) =>
      _isDark(c) ? darkTextSecondary : lightTextSecondary; // ink-muted
  static Color textTertiary(BuildContext c) =>
      _isDark(c) ? darkTextTertiary : lightTextTertiary; // ink-subtle
  static Color accent(BuildContext c) => _isDark(c) ? darkAccent : lightAccent;
  static Color onAccent(BuildContext c) =>
      _isDark(c) ? darkOnAccent : lightOnAccent;
  static Color accentGhost(BuildContext c) =>
      _isDark(c) ? darkAccentGhost : lightAccentGhost;
  static Color signalOk(BuildContext c) =>
      _isDark(c) ? darkSignalOk : lightSignalOk;
  static Color signalWarn(BuildContext c) =>
      _isDark(c) ? darkSignalWarn : lightSignalWarn;
  static Color signalDanger(BuildContext c) =>
      _isDark(c) ? darkSignalDanger : lightSignalDanger;
  static Color scrim(BuildContext c) => _isDark(c) ? darkScrim : lightScrim;

  static Color skeletonBase(BuildContext c) => surface(c);
  static Color skeletonHighlight(BuildContext c) => surfaceElevated(c);

  static bool _isDark(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark;
}
