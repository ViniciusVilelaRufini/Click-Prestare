import 'dart:convert';

import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// O lápis do autor (que leva ao Editar e ao Excluir) some quando a equipe já
/// falou — resposta pública ou mensagem no chat — porque a API recusa a
/// escrita nesses casos e o morador só descobria ao tentar.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    storageMorador({
      'token': 'token-morador',
      'user': {'id': 100, 'nome': 'Ana'},
    });
    Singleton.instance.id_condominio = 22;
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Map<String, dynamic> ocorrencia({String resposta = '', String? respostaAt}) => {
        'id': 9,
        'descricao': 'Barulho no 302',
        'tipo': 'Barulho',
        'tipoId': 1,
        'status': 'Pendente',
        'resposta': resposta,
        'resposta_at': respostaAt,
        'criado_por': 'Ana',
        'created_at': '2026-11-14T10:00:00.000Z',
        'anexos': '',
        'publica': false,
        'user': 100,
      };

  Future<List<String>> abrir(WidgetTester tester, Map<String, dynamic> oc, List<dynamic> chat) async {
    final chamadas = <String>[];
    ApiClient.client = MockClient((req) async {
      chamadas.add(req.url.path);
      if (req.url.path.endsWith('/ocorrencias/mensagens/get-all')) {
        return http.Response(jsonEncode(chat), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      if (req.url.path.endsWith('/ocorrencias/get')) {
        return http.Response(jsonEncode(oc), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('[]', 200);
    });
    tester.view.physicalSize = const Size(1800, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: DetailOcorrencia(id: 9)));
    await tester.pumpAndSettle();
    return chamadas;
  }

  testWidgets('sem resposta e chat só do autor: lápis aparece', (tester) async {
    await abrir(tester, ocorrencia(), [
      {'id_usuario': 100, 'mensagem': 'Alguém viu?'},
    ]);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('equipe escreveu no chat: lápis some', (tester) async {
    await abrir(tester, ocorrencia(), [
      {'id_usuario': 100, 'mensagem': 'Alguém viu?'},
      {'id_usuario': 7, 'mensagem': 'Estamos verificando.'},
    ]);
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('resposta pública da administração: lápis some sem buscar o chat', (tester) async {
    final chamadas = await abrir(
      tester,
      ocorrencia(resposta: 'Vamos verificar.', respostaAt: '2026-11-14T11:00:00.000Z'),
      [],
    );
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(chamadas.where((p) => p.endsWith('/mensagens/get-all')), isEmpty);
  });
}
