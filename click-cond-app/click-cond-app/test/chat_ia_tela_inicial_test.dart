import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

/// Achados da revisão da tela inicial da Prestare IA: texto dos atalhos
/// cortado em celulares comuns, atalhos que não funcionam para o funcionário
/// e a última pergunta escondida atrás do campo de digitar.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
  });

  tearDown(() async {
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester t, {double largura = 412, double escala = 1.0}) async {
    t.view.physicalSize = Size(largura * 2, 1800);
    t.view.devicePixelRatio = 2.0;
    addTearDown(t.view.reset);
    await t.pumpWidget(MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(escala)),
        child: child!,
      ),
      home: const ChatIaPage(),
    ));
    await t.pumpAndSettle();
  }

  for (final largura in [320.0, 360.0]) {
    testWidgets('atalhos do síndico sem texto cortado em ${largura.toInt()}dp com fonte 1,3x', (t) async {
      storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
      await abrir(t, largura: largura, escala: 1.3);
      final textos = find.descendant(of: find.byKey(const ValueKey('ia-acao')), matching: find.byType(RichText));
      expect(textos, findsWidgets);
      for (final e in textos.evaluate()) {
        final p = e.renderObject! as RenderParagraph;
        expect(p.didExceedMaxLines, isFalse, reason: p.text.toPlainText());
      }
    });
  }

  testWidgets('funcionário só vê atalhos que a IA aceita para a equipe', (t) async {
    storageFuncionario({'token': 't', 'user': {'id': 3, 'nome': 'Fun'}});
    await abrir(t);
    final acoes = find.byKey(const ValueKey('ia-acao'));
    expect(acoes, findsNWidgets(4));
    for (final titulo in ['LIBERAR', 'ABRIR', 'COMUNICADO', 'MANUTENÇÃO']) {
      expect(find.descendant(of: acoes, matching: find.text(titulo)), findsOneWidget, reason: titulo);
    }
    expect(find.text('RESERVAR'), findsNothing);
    expect(find.text('LER CONTA'), findsNothing);
  });

  testWidgets('a última pergunta não fica atrás do campo de digitar', (t) async {
    await abrir(t, largura: 360, escala: 1.3);
    final lista = find.ancestor(of: find.text('PERGUNTE'), matching: find.byType(ListView)).first;
    await t.drag(lista, const Offset(0, -3000));
    await t.pumpAndSettle();
    final ultima = t.getRect(find.byKey(const ValueKey('ia-pergunta')).last);
    final campo = t.getRect(find.byType(TextField));
    expect(ultima.bottom, lessThanOrEqualTo(campo.top), reason: 'pergunta $ultima, campo $campo');
  });
}
