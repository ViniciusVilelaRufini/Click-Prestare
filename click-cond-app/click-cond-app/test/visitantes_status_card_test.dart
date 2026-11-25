import 'dart:convert';

import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// O card da lista "Visitantes e prestadores" usa a regra do console
/// (utils/status_visita.dart). Bancada 25/11: "Rafael Costa - Teste" com
/// autorização do morador de 12 dias aparecia AUTORIZADO; o console dizia
/// "Autorização expirada".
String _iso(Duration d) => DateTime.now().toUtc().add(d).toIso8601String();

List<Map<String, dynamic>> _visitantes() => [
      {
        'id': 1,
        'nome': 'Rafael Costa - Teste',
        'is_prestador': 0,
        'apto_bloco': 'A',
        'apto': '106',
        'liberado': 1,
        'auth_status': 'autorizado',
        'auth_solicitado_em': _iso(const Duration(days: -12, minutes: -2)),
        'auth_respondido_em': _iso(const Duration(days: -12)),
        'created_at': _iso(const Duration(days: -12)),
        // Janela larga que ainda cobre agora: o app antigo dizia AUTORIZADO só por ela.
        'data_hora_inicio': _iso(const Duration(days: -12)),
        'data_hora_termino': _iso(const Duration(days: 1)),
        'data_entrada': null,
        'data_saida': null,
      },
      {
        'id': 2,
        'nome': 'Bloqueado Na Janela',
        'is_prestador': 0,
        'apto_bloco': 'A',
        'apto': '107',
        'liberado': 0,
        'created_at': _iso(const Duration(hours: -1)),
        'data_hora_inicio': _iso(const Duration(hours: -1)),
        'data_hora_termino': _iso(const Duration(hours: 1)),
        'data_entrada': null,
        'data_saida': null,
      },
    ];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    Singleton.instance.id_condominio = 11;
    ApiClient.client = MockClient((req) async {
      if (req.url.path.endsWith('/visitantes/get-all')) {
        return http.Response(jsonEncode(_visitantes()), 200,
            headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('[]', 200);
    });
    storageMorador({
      'token': 't',
      'user': {'id': 1, 'nome': 'Ana'},
    });
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  testWidgets('card não mostra AUTORIZADO para autorização vencida nem liberado=0',
      (tester) async {
    tester.view.physicalSize = const Size(400 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: ListVisitantes()));
    await tester.pumpAndSettle();
    // Quem ainda não entrou fica na aba "Cadastrados".
    await tester.tap(find.textContaining('CADASTRADOS'));
    await tester.pumpAndSettle();

    expect(find.text('Rafael Costa - Teste'), findsOneWidget);
    expect(find.text('AUTORIZADO'), findsNothing);
    expect(find.text('EXPIRADO'), findsOneWidget); // Rafael
    expect(find.text('FINALIZADO'), findsOneWidget); // liberado=0
  });
}
