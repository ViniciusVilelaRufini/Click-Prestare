import 'dart:ui' as ui;

import 'package:click/widgets/app/prestare_splash_animation.dart';
import 'package:click/widgets/app/prestare_splash_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

/// Conta quantas vezes o app real é montado: trocar de árvore no fim da
/// abertura repetiria o `HomePage._init` e o auto-login.
class _AppFalso extends StatefulWidget {
  const _AppFalso({required this.aoMontar});

  final VoidCallback aoMontar;

  @override
  State<_AppFalso> createState() => _AppFalsoState();
}

class _AppFalsoState extends State<_AppFalso> {
  @override
  void initState() {
    super.initState();
    widget.aoMontar();
  }

  @override
  Widget build(BuildContext context) => const Scaffold(body: Text('app real'));
}

Finder get _animacao => find.byType(PrestareSplashAnimation);

PrestareSplashPainter _painter(WidgetTester tester) {
  final paint = tester.widget<CustomPaint>(
    find.descendant(of: _animacao, matching: find.byType(CustomPaint)),
  );
  return paint.painter! as PrestareSplashPainter;
}

void main() {
  group('parser de path', () {
    test('entende M com L implícito, L, H, V, Q e Z', () {
      final path = parseSvgPath('M0 0 10 0L10 10H5V20Q5 30 0 30Z');
      expect(path.getBounds(), const Rect.fromLTRB(0, 0, 10, 30));
    });

    test('caixas de cursor e nome batem com o SVG', () {
      final cursor = parseSvgPath(kSplashCursor).getBounds();
      expect(cursor.left, closeTo(51.20, 0.001));
      expect(cursor.top, closeTo(65.20, 0.001));
      expect(cursor.right, closeTo(78.30, 0.001));
      expect(cursor.bottom, closeTo(94.80, 0.001));

      final nome = parseSvgPath(kSplashNome).getBounds();
      expect(nome.left, closeTo(16.12, 0.01));
      expect(nome.bottom, closeTo(116.10, 0.01));
    });
  });

  group('PrestareSplashAnimation', () {
    testWidgets('pinta sem exceção em 0s, 1s e 3s e descarta limpo', (
      tester,
    ) async {
      await tester.pumpWidget(
        const Directionality(
          textDirection: TextDirection.ltr,
          child: PrestareSplashAnimation(),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(_painter(tester).tempo.value, 0);

      await tester.pump(const Duration(seconds: 1));
      expect(tester.takeException(), isNull);
      expect(_painter(tester).tempo.value, closeTo(1, 0.001));

      await tester.pump(const Duration(seconds: 2));
      expect(tester.takeException(), isNull);
      expect(_painter(tester).tempo.value, closeTo(3, 0.001));

      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
      expect(tester.binding.transientCallbackCount, 0);
    });

    testWidgets('largura é min(160, 40% da tela) na proporção do viewBox', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(300, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(const PrestareSplashAnimation());
      var caixa = tester.getSize(
        find.descendant(of: _animacao, matching: find.byType(CustomPaint)),
      );
      expect(caixa.width, closeTo(120, 0.001));
      expect(caixa.height, closeTo(120 * 136 / 84, 0.001));

      tester.view.physicalSize = const Size(1000, 800);
      await tester.pump();
      caixa = tester.getSize(
        find.descendant(of: _animacao, matching: find.byType(CustomPaint)),
      );
      expect(caixa.width, closeTo(160, 0.001));
    });

    testWidgets('disableAnimations fixa o estado final, sem repintar', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: PrestareSplashAnimation(),
        ),
      );
      expect(_painter(tester).estatico, isTrue);
      await tester.pump(const Duration(seconds: 1));
      expect(tester.takeException(), isNull);
      expect(_painter(tester).estatico, isTrue);

      await tester.pumpWidget(const SizedBox());
      expect(tester.takeException(), isNull);
    });

    test('painter repinta só quando muda o relógio ou o modo', () {
      final relogio = ValueNotifier<double>(0);
      addTearDown(relogio.dispose);
      final a = PrestareSplashPainter(tempo: relogio);
      expect(a.shouldRepaint(PrestareSplashPainter(tempo: relogio)), isFalse);
      expect(
        a.shouldRepaint(PrestareSplashPainter(tempo: relogio, estatico: true)),
        isTrue,
      );
    });

    test('painter desenha em qualquer instante, inclusive no ciclo infinito',
        () {
      for (final t in <double>[0, .18, .5, 1.2, 1.7, 2.5, 4.3, 4.4, 60, 3600]) {
        final recorder = ui.PictureRecorder();
        final canvas = Canvas(recorder);
        final relogio = ValueNotifier<double>(t);
        PrestareSplashPainter(tempo: relogio)
            .paint(canvas, const Size(160, 259));
        recorder.endRecording().dispose();
        relogio.dispose();
      }
    });
  });

  group('PrestareSplashGate', () {
    Widget gate({required bool pronto, required VoidCallback aoMontar}) {
      return PrestareSplashGate(
        appPronto: pronto,
        builder: (_) => MaterialApp(home: _AppFalso(aoMontar: aoMontar)),
      );
    }

    testWidgets('sem app pronto a animação fica, mesmo além do mínimo', (
      tester,
    ) async {
      var montagens = 0;
      await tester.pumpWidget(gate(pronto: false, aoMontar: () => montagens++));
      expect(_animacao, findsOneWidget);

      await tester.pump(const Duration(seconds: 10));
      await tester.pump(const Duration(seconds: 10));
      expect(_animacao, findsOneWidget);
      expect(montagens, 0);
      expect(_painter(tester).tempo.value, closeTo(20, 0.001));
    });

    testWidgets(
        'app pronto antes do mínimo: sobe por baixo e a animação fica '
        'até 2,4s, depois some em ~300ms', (tester) async {
      var montagens = 0;
      await tester.pumpWidget(gate(pronto: false, aoMontar: () => montagens++));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pumpWidget(gate(pronto: true, aoMontar: () => montagens++));

      // Init, push e auto-login não esperam a animação.
      expect(montagens, 1);
      expect(find.text('app real'), findsOneWidget);
      expect(_animacao, findsOneWidget);

      await tester.pump(const Duration(milliseconds: 2200));
      expect(_animacao, findsOneWidget);
      expect(_opacidade(tester), 1);

      // Passou de 2,4s: começa o fade.
      await tester.pump(const Duration(milliseconds: 150));
      await tester.pump(const Duration(milliseconds: 150));
      expect(_animacao, findsOneWidget);
      expect(_opacidade(tester), inExclusiveRange(0, 1));

      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump(const Duration(milliseconds: 1));
      expect(_animacao, findsNothing);
      expect(find.text('app real'), findsOneWidget);
      expect(montagens, 1, reason: 'a troca não pode remontar o app');
      expect(tester.binding.transientCallbackCount, 0);
    });

    testWidgets('mínimo já cumprido: o fade começa quando o app fica pronto', (
      tester,
    ) async {
      var montagens = 0;
      await tester.pumpWidget(gate(pronto: false, aoMontar: () => montagens++));
      await tester.pump(const Duration(seconds: 2));
      await tester.pump(const Duration(seconds: 3));
      expect(_animacao, findsOneWidget);

      await tester.pumpWidget(gate(pronto: true, aoMontar: () => montagens++));
      await tester.pump(const Duration(milliseconds: 150));
      expect(_opacidade(tester), inExclusiveRange(0, 1));

      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump(const Duration(milliseconds: 1));
      expect(_animacao, findsNothing);
      expect(montagens, 1);
    });

    testWidgets('reconstruir o pai não reinicia o relógio nem remonta o app', (
      tester,
    ) async {
      var montagens = 0;
      await tester.pumpWidget(gate(pronto: true, aoMontar: () => montagens++));
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpWidget(gate(pronto: true, aoMontar: () => montagens++));
      await tester.pump(const Duration(milliseconds: 500));

      expect(_painter(tester).tempo.value, closeTo(1.5, 0.001));
      expect(montagens, 1);
    });

    testWidgets('toques não chegam ao app enquanto a animação cobre a tela', (
      tester,
    ) async {
      var toques = 0;
      await tester.pumpWidget(
        PrestareSplashGate(
          appPronto: true,
          builder: (_) => MaterialApp(
            home: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => toques++,
              child: const SizedBox.expand(),
            ),
          ),
        ),
      );
      await tester.tapAt(const Offset(100, 100));
      expect(toques, 0);

      await tester.pump(const Duration(milliseconds: 2500));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 1));
      await tester.tapAt(const Offset(100, 100));
      await tester.pump(const Duration(milliseconds: 500));
      expect(toques, 1);
    });

    testWidgets('a navegação segue viva pela navigatorKey depois da troca', (
      tester,
    ) async {
      final chave = GlobalKey<NavigatorState>();
      Widget arvore(bool pronto) => PrestareSplashGate(
            appPronto: pronto,
            builder: (_) => MaterialApp(
              navigatorKey: chave,
              home: const Text('início', textDirection: TextDirection.ltr),
            ),
          );
      await tester.pumpWidget(arvore(false));
      expect(chave.currentState, isNull);

      await tester.pumpWidget(arvore(true));
      final navegador = chave.currentState;
      expect(navegador, isNotNull);

      await tester.pump(const Duration(milliseconds: 2500));
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 1));
      expect(_animacao, findsNothing);
      expect(identical(chave.currentState, navegador), isTrue);
    });

    testWidgets('descartar no meio da abertura não deixa ticker nem setState', (
      tester,
    ) async {
      await tester.pumpWidget(gate(pronto: true, aoMontar: () {}));
      await tester.pump(const Duration(milliseconds: 2450));
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
      expect(tester.takeException(), isNull);
      expect(tester.binding.transientCallbackCount, 0);
    });

    testWidgets('disableAnimations: estado final durante toda a abertura', (
      tester,
    ) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
          tester.platformDispatcher.clearAccessibilityFeaturesTestValue);

      await tester.pumpWidget(gate(pronto: false, aoMontar: () {}));
      expect(_painter(tester).estatico, isTrue);
      await tester.pump(const Duration(seconds: 3));
      expect(_animacao, findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}

double _opacidade(WidgetTester tester) {
  return tester
      .renderObject<RenderAnimatedOpacity>(
        find.ancestor(of: _animacao, matching: find.byType(FadeTransition)),
      )
      .opacity
      .value;
}
