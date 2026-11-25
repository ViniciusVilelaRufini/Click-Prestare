import 'dart:async';
import 'dart:convert';

import 'package:click/pages/shared/chat_ia/chat_ia_page.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Trocar de conversa enquanto a IA responde: a resposta da pergunta antiga
/// caía na conversa nova em branco e `_conversaId ??= resposta.conversaId`
/// amarrava a conversa nova ao id da antiga (as próximas perguntas iam para o
/// histórico errado).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    Singleton.instance.id_condominio = 22;
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  testWidgets('"Nova conversa" durante o envio descarta a resposta antiga e não herda o id', (t) async {
    final corpos = <Map<String, dynamic>>[];
    final primeira = Completer<http.Response>();
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/chat-ia/perguntar')) {
        corpos.add(jsonDecode(req.body) as Map<String, dynamic>);
        if (corpos.length == 1) return primeira.future;
        return http.Response(jsonEncode({'resposta': 'Resposta nova', 'conversa_id': 'c-nova'}), 200,
            headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('[]', 200);
    });

    t.view.physicalSize = const Size(412 * 2, 1800);
    t.view.devicePixelRatio = 2.0;
    addTearDown(t.view.reset);
    await t.pumpWidget(const MaterialApp(home: ChatIaPage()));
    await t.pumpAndSettle();

    await t.enterText(find.byType(TextField), 'Quanto devo de condomínio?');
    await t.testTextInput.receiveAction(TextInputAction.send);
    await t.pump();
    expect(corpos, hasLength(1));

    await t.tap(find.byTooltip('Nova conversa'));
    await t.pump();

    primeira.complete(http.Response(jsonEncode({'resposta': 'Resposta antiga', 'conversa_id': 'c-antiga'}), 200,
        headers: {'content-type': 'application/json; charset=utf-8'}));
    await t.pumpAndSettle();
    expect(find.textContaining('Resposta antiga', findRichText: true), findsNothing);

    await t.enterText(find.byType(TextField), 'Tem reserva hoje?');
    await t.testTextInput.receiveAction(TextInputAction.send);
    await t.pumpAndSettle();
    expect(corpos, hasLength(2));
    expect(find.textContaining('Resposta nova', findRichText: true), findsWidgets);
    expect(corpos[1].containsKey('conversa_id'), isFalse, reason: 'conversa nova não herda o id da antiga');
  });
}
