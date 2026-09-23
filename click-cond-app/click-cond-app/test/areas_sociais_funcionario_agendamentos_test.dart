import 'package:click/pages/shared/areas%20sociais/list_areas_sociais.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  testWidgets(
    'funcionário com permissão de áreas sociais carrega a fila de agendamentos do seu condomínio',
    (tester) async {
      storageFuncionario({
        'token': 'token-funcionario',
        'user': {'id': 7, 'nome': 'Porteiro', 'areas_sociais': 1},
      });
      Singleton.instance.id_condominio = 22;

      final requests = <Uri>[];
      ApiClient.client = MockClient((request) async {
        requests.add(request.url);
        return http.Response('[]', 200);
      });

      await tester.pumpWidget(const MaterialApp(home: ListAreasSociais()));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(
        requests.any((uri) => uri.path.endsWith('/areas-sociais/agendamentos/get-all')),
        isTrue,
      );
      expect(
        requests.where((uri) => uri.path.endsWith('/areas-sociais/agendamentos/get-all')).single.queryParameters['id_condominio'],
        '22',
      );
    },
  );
}
