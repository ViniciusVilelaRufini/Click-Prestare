import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

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

  // As sugestões são os cartões com o texto de cada pergunta.
  Finder cartoes() => find.byKey(const ValueKey('ia-sugestao'));

  testWidgets('ícone do topo no degradê da marca', (t) async {
    await abrir(t);
    final degrade = find.ancestor(
      of: find.byIcon(PhosphorIcons.sparkle),
      matching: find.byWidgetPredicate((w) =>
          w is DecoratedBox &&
          w.decoration is BoxDecoration &&
          (w.decoration as BoxDecoration).gradient is LinearGradient),
    );
    expect(degrade, findsWidgets);
  });

  testWidgets('sugestões em cartões com ícone dissolvendo e texto legível', (t) async {
    await abrir(t);
    expect(cartoes(), findsNWidgets(3));
    for (final e in cartoes().evaluate()) {
      final cartao = find.byWidget(e.widget);
      expect(find.descendant(of: cartao, matching: find.byType(ShaderMask)), findsOneWidget);
      final texto = find.descendant(of: cartao, matching: find.byType(Text)).first;
      expect(t.widget<Text>(texto).style?.color, AppColors.textPrimary(t.element(texto)));
    }
  });

  testWidgets('botão de enviar quadrado e amarelo', (t) async {
    await abrir(t);
    final caixa = find.ancestor(
      of: find.byIcon(PhosphorIcons.paperPlaneRight),
      matching: find.byWidgetPredicate((w) =>
          w is Container && w.decoration is BoxDecoration &&
          (w.decoration as BoxDecoration).color == AppColors.brand &&
          (w.decoration as BoxDecoration).shape == BoxShape.rectangle),
    );
    expect(caixa, findsOneWidget);
  });

  testWidgets('cabe numa tela estreita (320)', (t) async {
    await abrir(t, largura: 320);
    expect(t.takeException(), isNull);
  });

  testWidgets('sugestão longa quebra linha em vez de sair cortada', (t) async {
    await abrir(t, largura: 412);
    for (final e in find.descendant(of: cartoes(), matching: find.byType(RichText)).evaluate()) {
      final p = e.renderObject! as RenderParagraph;
      // Só caracteres visíveis: o espaço no fim de uma linha quebrada tem
      // caixa além da borda, sem nada desenhado.
      final s = p.text.toPlainText();
      var direita = 0.0;
      for (var i = 0; i < s.length; i++) {
        if (s[i].trim().isEmpty) continue;
        for (final box in p.getBoxesForSelection(TextSelection(baseOffset: i, extentOffset: i + 1))) {
          if (box.right > direita) direita = box.right;
        }
      }
      expect(direita, lessThanOrEqualTo(p.size.width + 0.5), reason: p.text.toPlainText());
      expect(p.didExceedMaxLines, isFalse, reason: p.text.toPlainText());
    }
  });
}
