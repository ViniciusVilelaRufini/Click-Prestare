import 'package:click/theme/app_colors.dart';
import 'package:click/widgets/app/evento_linha.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// "Meus eventos" no mesmo desenho das linhas de evento da portaria web: foto
/// (ou inicial) dissolvendo à esquerda, selo colorido de entrada/saída e o
/// nome com hora e tipo embaixo.
void main() {
  Future<void> montar(WidgetTester t, {required bool entrada, String? foto, VoidCallback? onTap}) async {
    await t.pumpWidget(MaterialApp(
      home: Scaffold(
        body: EventoLinha(
          nome: 'Rafael Costa - Teste',
          entrada: entrada,
          tipo: 'Visitante',
          hora: '16:43',
          foto: foto,
          onTap: onTap ?? () {},
        ),
      ),
    ));
  }

  testWidgets('entrada: selo verde e meta com hora e tipo', (t) async {
    await montar(t, entrada: true);
    final selo = t.widget<Text>(find.text('ENTRADA'));
    expect(selo.style?.color, AppColors.success);
    expect(find.text('Rafael Costa - Teste'), findsOneWidget);
    expect(find.text('16:43 · Visitante'), findsOneWidget);
  });

  testWidgets('saída: selo no cinza do texto', (t) async {
    await montar(t, entrada: false);
    final ctx = t.element(find.text('SAÍDA'));
    expect(t.widget<Text>(find.text('SAÍDA')).style?.color, AppColors.textTertiary(ctx));
  });

  testWidgets('sem foto mostra a inicial na cor do evento', (t) async {
    await montar(t, entrada: true);
    expect(find.text('R'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('com foto mostra a imagem dissolvendo (ShaderMask)', (t) async {
    await montar(t, entrada: true, foto: 'https://cdn.exemplo/r.jpg');
    expect(find.descendant(of: find.byType(ShaderMask), matching: find.byType(Image)), findsOneWidget);
  });

  // Faixa única na cor do evento: colorida já na borda esquerda (sem emenda
  // com um quadrado da inicial) e mais leve no tema claro.
  Future<LinearGradient> faixa(WidgetTester t, Brightness brilho) async {
    await t.pumpWidget(MaterialApp(
      theme: ThemeData(brightness: brilho),
      home: Scaffold(
        body: EventoLinha(nome: 'Rafael', entrada: true, tipo: 'Visitante', hora: '13:57', onTap: () {}),
      ),
    ));
    await t.pumpAndSettle(); // a troca de tema do MaterialApp é animada
    final caixa = t.widget<DecoratedBox>(find.byKey(const ValueKey('evento-faixa')));
    return (caixa.decoration as BoxDecoration).gradient! as LinearGradient;
  }

  testWidgets('faixa começa colorida na borda e é mais leve no claro', (t) async {
    final claro = await faixa(t, Brightness.light);
    final escuro = await faixa(t, Brightness.dark);
    expect(claro.stops!.first, 0);
    expect(claro.colors.first.a, greaterThan(0));
    expect(claro.colors.first.a, lessThan(escuro.colors.first.a));
    expect(find.byType(ColoredBox).evaluate().where((e) =>
        (e.widget as ColoredBox).color == AppColors.surfaceElevated(e)), isEmpty);
  });

  testWidgets('linha extra opcional (método e condomínio)', (t) async {
    await t.pumpWidget(MaterialApp(home: Scaffold(body: EventoLinha(
      nome: 'Rafael', entrada: false, tipo: 'Visitante', hora: '09/11/2026 às 16:43',
      detalhe: 'PIN / Manual · Boa vista', onTap: () {},
    ))));
    expect(find.text('09/11/2026 às 16:43 · Visitante'), findsOneWidget);
    expect(find.text('PIN / Manual · Boa vista'), findsOneWidget);
  });

  testWidgets('toque abre o evento', (t) async {
    var abriu = false;
    await montar(t, entrada: true, onTap: () => abriu = true);
    await t.tap(find.text('Rafael Costa - Teste'));
    expect(abriu, isTrue);
  });
}
