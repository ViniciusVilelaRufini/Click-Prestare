import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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

  testWidgets('barra do topo opaca: a conversa rolada não aparece por trás', (t) async {
    await abrir(t);
    final titulo = find.text('PRESTARE IA');
    final ctx = t.element(titulo);
    final fundo = find.ancestor(
      of: titulo,
      matching: find.byWidgetPredicate((w) => w is ColoredBox && w.color == AppColors.bg(ctx)),
    );
    expect(fundo, findsOneWidget);
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

  testWidgets('sugestão longa quebra linha em vez de sair cortada', (t) async {
    await abrir(t, largura: 412);
    for (final e in find.byType(ActionChip).evaluate()) {
      final r = t.getRect(find.byWidget(e.widget));
      expect(r.right, lessThanOrEqualTo(412), reason: (e.widget as ActionChip).label.toString());
    }
    // O chip ocupa a largura toda e o texto era cortado dentro dele: as letras
    // desenhadas passavam da largura do parágrafo (e sumiam no fade).
    for (final e in find.descendant(of: find.byType(ActionChip), matching: find.byType(RichText)).evaluate()) {
      final p = e.renderObject! as RenderParagraph;
      final tudo = TextSelection(baseOffset: 0, extentOffset: p.text.toPlainText().length);
      final direita = p.getBoxesForSelection(tudo).map((b) => b.right).reduce((a, b) => a > b ? a : b);
      expect(direita, lessThanOrEqualTo(p.size.width + 0.5), reason: p.text.toPlainText());
      expect(p.didExceedMaxLines, isFalse, reason: p.text.toPlainText());
    }
  });
}
