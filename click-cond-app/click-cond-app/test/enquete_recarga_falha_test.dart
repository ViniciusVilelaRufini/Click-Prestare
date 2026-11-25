import 'dart:convert';

import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Qualquer falha ao recarregar a enquete (por exemplo logo depois de um voto
/// aceito) trocava a tela inteira por um branco sem mensagem nem saída.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const json = {'content-type': 'application/json; charset=utf-8'};
  final enquete = {
    'votacao': {
      'id': 7,
      'titulo': 'Cor da fachada',
      'descricao': 'A pintura começa em novembro.',
      'data_inicio': '01/10/2026',
      'data_termino': '30/10/2099',
      'status': 1,
      'opcoes': ['12;Azul;1', '13;Branco;1'],
    },
    'meuVoto': <String>[],
  };

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

  Future<void> abrir(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: DetailEnquete(id: 7)));
    await tester.pumpAndSettle();
  }

  testWidgets('recarga depois do voto que falha mantém a enquete e avisa', (tester) async {
    var detalhes = 0;
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/enquetes/get')) {
        detalhes++;
        if (detalhes > 1) return http.Response('erro', 503);
        return http.Response(jsonEncode(enquete), 200, headers: json);
      }
      if (req.url.path.endsWith('/voto/insert')) return http.Response('{}', 200, headers: json);
      return http.Response('', 404);
    });
    await abrir(tester);
    expect(find.text('Cor da fachada'), findsOneWidget);

    await tester.ensureVisible(find.text('Branco'));
    await tester.tap(find.text('Branco'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(DetailEnquete.chaveBotaoVotar));
    await tester.pumpAndSettle();

    expect(detalhes, 2);
    expect(find.textContaining('Não foi possível atualizar a enquete'), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.text('Cor da fachada'), findsOneWidget, reason: 'a enquete fica na tela');
  });

  testWidgets('primeira carga que falha mostra erro com tentar de novo', (tester) async {
    var falhar = true;
    ApiClient.client = MockClient((req) async {
      if (falhar) throw http.ClientException('sem rede');
      return http.Response(jsonEncode(enquete), 200, headers: json);
    });
    await abrir(tester);
    expect(find.text('Não foi possível carregar a enquete.'), findsOneWidget);

    falhar = false;
    await tester.tap(find.text('TENTAR DE NOVO'));
    await tester.pumpAndSettle();
    expect(find.text('Cor da fachada'), findsOneWidget);
  });
}
