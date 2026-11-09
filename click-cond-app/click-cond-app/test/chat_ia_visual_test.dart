import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// O cabeçalho da Prestare IA era um bloco preto sólido, diferente de todas as
/// outras telas; as sugestões eram pílulas de contorno quase invisível.
void main() {
  Future<void> abrir(WidgetTester t, {double largura = 540}) async {
    t.view.physicalSize = Size(largura * 2, 2400);
    t.view.devicePixelRatio = 2.0;
    addTearDown(t.view.resetPhysicalSize);
    await t.pumpWidget(const MaterialApp(home: ChatIaPage()));
    await t.pumpAndSettle();
  }

  testWidgets('título no padrão das telas, sem bloco preto', (t) async {
    await abrir(t);
    final titulo = find.text('PRESTARE IA');
    final ctx = t.element(titulo);
    expect(t.widget<Text>(titulo).style?.color, AppColors.textPrimary(ctx));
    final blocoPreto = find.ancestor(
      of: titulo,
      matching: find.byWidgetPredicate((w) =>
          w is Container &&
          w.decoration is BoxDecoration &&
          (w.decoration as BoxDecoration).color == AppColors.primary),
    );
    expect(blocoPreto, findsNothing);
  });

  testWidgets('sugestões com cantos retos e texto legível', (t) async {
    await abrir(t);
    final chips = t.widgetList<ActionChip>(find.byType(ActionChip)).toList();
    expect(chips, isNotEmpty);
    final ctx = t.element(find.byType(ActionChip).first);
    for (final c in chips) {
      expect(c.shape, isA<RoundedRectangleBorder>());
      expect((c.shape as RoundedRectangleBorder).borderRadius, BorderRadius.zero);
      expect((c.label as Text).style?.color, AppColors.textPrimary(ctx));
    }
  });

  testWidgets('cabe numa tela estreita (320)', (t) async {
    await abrir(t, largura: 320);
    expect(t.takeException(), isNull);
  });
}
