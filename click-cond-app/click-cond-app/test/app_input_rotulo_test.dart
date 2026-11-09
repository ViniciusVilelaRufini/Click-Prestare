import 'package:click/widgets/app/app_input.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// O rótulo em repouso tem 13; ao subir para a borda caía para 11 (o
/// `AppTypography.label`) e ficava minúsculo nos formulários.
void main() {
  testWidgets('rótulo flutuante legível (12) e no mesmo espaçamento', (t) async {
    await t.pumpWidget(MaterialApp(
      home: Scaffold(
        body: AppInput(label: 'Telefone (Opcional)', controller: TextEditingController(text: '17')),
      ),
    ));
    final deco = t.widget<TextField>(find.byType(TextField)).decoration!;
    expect(deco.labelText, 'TELEFONE (OPCIONAL)');
    // O InputDecorator desenha o rótulo flutuante a 75% do estilo: 16 → 12 na tela.
    expect(deco.floatingLabelStyle!.fontSize, 16);
    expect(deco.floatingLabelStyle!.letterSpacing, closeTo(16 * 0.16, 0.001));
  });
}
