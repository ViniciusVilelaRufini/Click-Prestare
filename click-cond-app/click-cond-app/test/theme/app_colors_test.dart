import 'dart:ui' show PlatformDispatcher;

import 'package:click/theme/app_colors.dart';
import 'package:click/theme/theme_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

double _contraste(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final maior = la > lb ? la : lb;
  final menor = la > lb ? lb : la;
  return (maior + 0.05) / (menor + 0.05);
}

void main() {
  tearDown(() => ThemeController.instance.debugSetMode(ThemeMode.system));

  group('modo escuro', () {
    setUp(() => ThemeController.instance.debugSetMode(ThemeMode.dark));

    test('primário branco com texto preto', () {
      expect(AppColors.brightness, Brightness.dark);
      expect(AppColors.primary, const Color(0xFFFFFFFF));
      expect(AppColors.onPrimary, const Color(0xFF000000));
    });

    test('marca amarela com texto preto', () {
      expect(AppColors.brand, const Color(0xFFFFC83D));
      expect(AppColors.onBrand, const Color(0xFF000000));
      expect(AppColors.brandInk, const Color(0xFFFFC83D));
      expect(AppColors.brandSoft, const Color(0x1FFFC83D));
    });

    test('sinais do tema escuro', () {
      expect(AppColors.success, const Color(0xFF5EC28A));
      expect(AppColors.warning, const Color(0xFFE3B04B));
      expect(AppColors.error, const Color(0xFFFF6B6B));
    });
  });

  group('modo claro', () {
    setUp(() => ThemeController.instance.debugSetMode(ThemeMode.light));

    test('primário preto com texto branco', () {
      expect(AppColors.brightness, Brightness.light);
      expect(AppColors.primary, const Color(0xFF000000));
      expect(AppColors.onPrimary, const Color(0xFFFFFFFF));
    });

    test('marca amarela com texto preto, tinta escura para texto', () {
      expect(AppColors.brand, const Color(0xFFF2B10F));
      expect(AppColors.onBrand, const Color(0xFF000000));
      expect(AppColors.brandInk, const Color(0xFF8A5A00));
      expect(AppColors.brandSoft, const Color(0x29F2B10F));
      expect(AppColors.primary, const Color(0xFF000000));
    });

    test('sinais do tema claro', () {
      expect(AppColors.success, const Color(0xFF1A7A48));
      expect(AppColors.warning, const Color(0xFF946000));
      expect(AppColors.error, const Color(0xFFC42D33));
    });
  });

  test('modo sistema segue o brilho do aparelho', () {
    ThemeController.instance.debugSetMode(ThemeMode.system);
    expect(
      AppColors.brightness,
      PlatformDispatcher.instance.platformBrightness,
    );
  });

  for (final modo in [ThemeMode.light, ThemeMode.dark]) {
    test('contraste em $modo', () {
      ThemeController.instance.debugSetMode(modo);
      expect(_contraste(AppColors.onPrimary, AppColors.primary), 21);
      expect(_contraste(AppColors.onPrimary, AppColors.primaryDark), 21);
      expect(_contraste(AppColors.onPrimary, AppColors.primaryGradientEnd), 21);
      // Os sinais também servem de fundo para selos e botões antigos.
      for (final sinal in [
        AppColors.success,
        AppColors.warning,
        AppColors.error,
      ]) {
        expect(
          _contraste(AppColors.on(sinal), sinal),
          greaterThanOrEqualTo(4.5),
        );
      }
    });
  }

  test('AppColors.on escolhe a tinta legível', () {
    expect(AppColors.on(Colors.black), Colors.white);
    expect(AppColors.on(Colors.white), Colors.black);
  });

  const esperadoEscuro = {
    'bg': Color(0xFF000000),
    'bg100': Color(0xFF0B0B0B),
    'surface': Color(0xFF141414),
    'surfaceElevated': Color(0xFF1F1F1F),
    'border': Color(0xFF242424),
    'borderStrong': Color(0xFF666666),
    'textPrimary': Color(0xFFFFFFFF),
    'textSecondary': Color(0xFFA3A3A3),
    'textTertiary': Color(0xFF8A8A8A),
    'accent': Color(0xFFFFFFFF),
    'onAccent': Color(0xFF000000),
    'accentGhost': Color(0x14FFFFFF),
    'signalOk': Color(0xFF5EC28A),
    'signalWarn': Color(0xFFE3B04B),
    'signalDanger': Color(0xFFFF6B6B),
  };
  const esperadoClaro = {
    'bg': Color(0xFFFFFFFF),
    'bg100': Color(0xFFFAFAFA),
    'surface': Color(0xFFF4F4F4),
    'surfaceElevated': Color(0xFFE9E9E9),
    'border': Color(0xFFE2E2E2),
    'borderStrong': Color(0xFF888888),
    'textPrimary': Color(0xFF000000),
    'textSecondary': Color(0xFF555555),
    'textTertiary': Color(0xFF6B6B6B),
    'accent': Color(0xFF000000),
    'onAccent': Color(0xFFFFFFFF),
    'accentGhost': Color(0x0D000000),
    'signalOk': Color(0xFF1A7A48),
    'signalWarn': Color(0xFF946000),
    'signalDanger': Color(0xFFC42D33),
  };

  Map<String, Color> lidos(BuildContext c) => {
        'bg': AppColors.bg(c),
        'bg100': AppColors.bg100(c),
        'surface': AppColors.surface(c),
        'surfaceElevated': AppColors.surfaceElevated(c),
        'border': AppColors.border(c),
        'borderStrong': AppColors.borderStrong(c),
        'textPrimary': AppColors.textPrimary(c),
        'textSecondary': AppColors.textSecondary(c),
        'textTertiary': AppColors.textTertiary(c),
        'accent': AppColors.accent(c),
        'onAccent': AppColors.onAccent(c),
        'accentGhost': AppColors.accentGhost(c),
        'signalOk': AppColors.signalOk(c),
        'signalWarn': AppColors.signalWarn(c),
        'signalDanger': AppColors.signalDanger(c),
      };

  // O modo do controlador fica no oposto do tema da árvore: os helpers têm de
  // seguir o Theme, não o getter de brilho.
  for (final caso in [
    (ThemeData.dark(), ThemeMode.light, esperadoEscuro, 'escuro'),
    (ThemeData.light(), ThemeMode.dark, esperadoClaro, 'claro'),
  ]) {
    testWidgets('helpers contextuais no tema ${caso.$4}', (tester) async {
      ThemeController.instance.debugSetMode(caso.$2);
      late BuildContext contexto;
      await tester.pumpWidget(
        MaterialApp(
          theme: caso.$1,
          home: Builder(
            builder: (c) {
              contexto = c;
              return const SizedBox();
            },
          ),
        ),
      );
      expect(lidos(contexto), caso.$3);
    });
  }
}
