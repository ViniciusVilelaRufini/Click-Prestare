import 'dart:convert';

import 'package:click/pages/shared/ocorrencias/list_ocorrencias_todos.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Recarga depois de uma ação (voltar do detalhe da ocorrência depois de mudar
/// o status) e o puxar-para-atualizar usavam `apiGetAll`, que devolve `[]` em
/// 401/5xx/sem rede: a tela mostrava "nada por aqui" logo depois de uma ação
/// que deu certo. Agora passam pela recarga, que mantém a lista em falha.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
    ApiClient.tokenProvider = () => 'sessao';
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  testWidgets('ocorrências: puxar para atualizar com a rede caindo mantém a lista', (tester) async {
    storageMorador({'token': 'sessao', 'user': {'id': 100, 'nome': 'Ana'}});
    var falhar = false;
    var buscas = 0;
    ApiClient.client = MockClient((req) async {
      buscas++;
      if (falhar) return http.Response('erro', 503);
      return http.Response(
          jsonEncode([
            {'id': 1, 'tipo': 'Barulho no 302', 'status': 'Pendente', 'created_at': '2026-11-14T10:00:00.000Z'}
          ]),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'});
    });

    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: ListOcorrenciasTodos())));
    await tester.pumpAndSettle();
    expect(find.text('BARULHO NO 302'), findsOneWidget);

    falhar = true;
    final antes = buscas;
    await tester.fling(find.text('BARULHO NO 302'), const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(buscas, greaterThan(antes));
    expect(find.text('BARULHO NO 302'), findsOneWidget);
  });
}
