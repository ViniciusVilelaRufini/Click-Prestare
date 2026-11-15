import 'dart:async';
import 'dart:convert';

import 'package:click/pages/shared/ocorrencias/detail_ocorrencia.dart';
import 'package:click/pages/shared/ocorrencias/ocorrencia_chat.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_button.dart';
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

  /// Resposta do chat: lista (JSON 200), [_Falha] (rede caiu) ou um
  /// Completer (o chat ainda não respondeu). Mutável para o teste trocar o
  /// chat entre a ida e a volta da tela de conversa.
  late Object chat;

  Future<List<String>> abrir(WidgetTester tester, Map<String, dynamic> oc, Object chatInicial,
      {bool settle = true}) async {
    chat = chatInicial;
    final chamadas = <String>[];
    ApiClient.client = MockClient((req) async {
      chamadas.add(req.url.path);
      if (req.url.path.endsWith('/ocorrencias/mensagens/get-all')) {
        final c = chat;
        if (c is _Falha) throw http.ClientException('sem rede');
        final lista = c is Completer<List<dynamic>> ? await c.future : c;
        return http.Response(jsonEncode(lista), 200, headers: {'content-type': 'application/json; charset=utf-8'});
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
    if (settle) await tester.pumpAndSettle();
    return chamadas;
  }

  int buscasDoChat(List<String> chamadas) => chamadas.where((p) => p.endsWith('/mensagens/get-all')).length;

  testWidgets('chat buscado e vazio: lápis aparece', (tester) async {
    final chamadas = await abrir(tester, ocorrencia(), <dynamic>[]);
    expect(buscasDoChat(chamadas), 1);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('chat só do autor: lápis aparece', (tester) async {
    final chamadas = await abrir(tester, ocorrencia(), [
      {'id_usuario': 100, 'mensagem': 'Alguém viu?'},
    ]);
    expect(buscasDoChat(chamadas), 1);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('equipe escreveu no chat: lápis some', (tester) async {
    await abrir(tester, ocorrencia(), [
      {'id_usuario': 100, 'mensagem': 'Alguém viu?'},
      {'id_usuario': 7, 'mensagem': 'Estamos verificando.'},
    ]);
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('chat falhou (rede): lápis aparece, a recusa da API cobre o resto', (tester) async {
    final chamadas = await abrir(tester, ocorrencia(), _Falha());
    expect(buscasDoChat(chamadas), 1);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('chat com itens que não são mensagem: ignora e o lápis aparece', (tester) async {
    await abrir(tester, ocorrencia(), <dynamic>['x', 3, null, true]);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('enquanto o chat não responde, o lápis fica oculto', (tester) async {
    final pendente = Completer<List<dynamic>>();
    await abrir(tester, ocorrencia(), pendente, settle: false);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byType(FloatingActionButton), findsNothing);
    pendente.complete(<dynamic>[]);
    await tester.pumpAndSettle();
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('ao voltar do chat, confere o lápis de novo', (tester) async {
    final chamadas = await abrir(tester, ocorrencia(), <dynamic>[]);
    expect(find.byType(FloatingActionButton), findsOneWidget);

    final botaoChat = find.byWidgetPredicate((w) => w is AppButton && w.label == 'Chat da Ocorrência');
    await tester.ensureVisible(botaoChat);
    await tester.tap(botaoChat);
    await tester.pumpAndSettle();
    expect(find.byType(OcorrenciaChatPage), findsOneWidget);

    // A equipe respondeu enquanto o morador estava na conversa.
    chat = <dynamic>[
      {'id_usuario': 7, 'mensagem': 'Estamos verificando.'},
    ];
    Navigator.of(tester.element(find.byType(OcorrenciaChatPage))).pop();
    await tester.pumpAndSettle();

    expect(find.byType(OcorrenciaChatPage), findsNothing);
    expect(buscasDoChat(chamadas), greaterThanOrEqualTo(2));
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('resposta pública da administração: lápis some sem buscar o chat', (tester) async {
    final chamadas = await abrir(
      tester,
      ocorrencia(resposta: 'Vamos verificar.', respostaAt: '2026-11-14T11:00:00.000Z'),
      <dynamic>[],
    );
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(buscasDoChat(chamadas), 0);
  });

  testWidgets('registro legado com texto e sem resposta_at mantém o lápis', (tester) async {
    await abrir(tester, ocorrencia(resposta: 'Texto antigo'), <dynamic>[]);
    expect(find.byType(FloatingActionButton), findsOneWidget);
  });
}

class _Falha {}
