import 'dart:convert';

import 'package:click/pages/shared/visitantes/list_visitantes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

List<Map<String, dynamic>> _visitantes() => [
      {
        'id': 1,
        'nome': 'Maria Aparecida de Albuquerque e Souza Vasconcelos Neto',
        'is_prestador': 0,
        'apto_bloco': 'Bloco Residencial Jardim das Acácias',
        'apto': '1204',
        'data_entrada': DateTime.now()
            .subtract(const Duration(hours: 5, minutes: 3))
            .toIso8601String(),
        'data_saida': null,
        'codigo_acesso': '123456',
        'liberado': 1,
      },
      {
        'id': 2,
        'nome': 'Prestador com nome muito longo para a tela estreita',
        'is_prestador': 1,
        'apto_bloco': 'A',
        'apto': '10',
        'data_saida': DateTime.now()
            .subtract(const Duration(days: 3))
            .toIso8601String(),
        'data_entrada': DateTime.now()
            .subtract(const Duration(days: 3, hours: 2))
            .toIso8601String(),
      },
    ];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    Singleton.instance.id_condominio = 11;
    ApiClient.client = MockClient(
        (_) async => http.Response(jsonEncode(_visitantes()), 200));
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

  for (final escuro in [false, true]) {
    testWidgets('rodapé do card cabe a 320dp com texto longo (${escuro ? 'escuro' : 'claro'})',
        (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 640 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: escuro ? ThemeData.dark() : ThemeData.light(),
        home: const ListVisitantes(),
      ));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  }
}
