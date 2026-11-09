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

  testWidgets('toque abre o evento', (t) async {
    var abriu = false;
    await montar(t, entrada: true, onTap: () => abriu = true);
    await t.tap(find.text('Rafael Costa - Teste'));
    expect(abriu, isTrue);
  });
}
