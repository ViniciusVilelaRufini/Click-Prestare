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

  testWidgets('helpers contextuais seguem o Theme da árvore', (tester) async {
    late BuildContext contexto;
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.dark(),
        home: Builder(
          builder: (c) {
            contexto = c;
            return const SizedBox();
          },
        ),
      ),
    );
    expect(AppColors.bg(contexto), AppColors.darkBg);
    expect(AppColors.surface(contexto), const Color(0xFF141414));
    expect(AppColors.border(contexto), const Color(0xFF242424));
    expect(AppColors.borderStrong(contexto), const Color(0xFF666666));
    expect(AppColors.textPrimary(contexto), const Color(0xFFFFFFFF));
    expect(AppColors.accent(contexto), const Color(0xFFFFFFFF));
    expect(AppColors.onAccent(contexto), const Color(0xFF000000));
  });
}
