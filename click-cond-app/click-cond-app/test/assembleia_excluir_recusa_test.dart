import 'dart:convert';

import 'package:click/pages/shared/assembleias/new_assembleia.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Revisão r5 (A2): excluir assembleia com votos mostra a recusa da API, não o
// "Houve um erro" genérico.

const _json = {'content-type': 'application/json; charset=utf-8'};
const _recusa = 'Esta assembleia já tem votos e não pode ser excluída. Finalize-a com a ATA.';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<Map<String, dynamic>> remocoes;

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    remocoes = [];
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  void servir(http.Response Function() respostaRemove) {
    ApiClient.client = MockClient((request) async {
      if (request.url.path.endsWith('/assembleias/get')) {
        return http.Response(
            jsonEncode({
              'assembleia': {
                'id': 5,
                'titulo': 'AGO',
                'descricao': '',
                'data': '11/10/2026',
                'hora': '19:30',
                'local': '',
                'link': '',
                'anexos': '',
              },
              'votacoes': [],
              'meusVotos': [],
            }),
            200,
            headers: _json);
      }
      if (request.url.path.endsWith('/assembleias/remove')) {
        remocoes.add(jsonDecode(request.body) as Map<String, dynamic>);
        return respostaRemove();
      }
      return http.Response('', 404);
    });
  }

  Future<void> excluir(WidgetTester tester) async {
    // showConfirmDialog estoura com a fonte de teste < ~400dp.
    tester.view.physicalSize = const Size(600 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: NewAssembleia(isEdit: true, myId: 5)));
    await tester.pumpAndSettle();
    final botao = find.text('Excluir'.toUpperCase());
    await tester.ensureVisible(botao);
    await tester.pumpAndSettle();
    await tester.tap(botao);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sim'));
    await tester.pumpAndSettle();
  }

  testWidgets('400 com message: mostra a recusa da API', (tester) async {
    servir(() => http.Response(jsonEncode({'message': _recusa}), 400, headers: _json));
    await excluir(tester);
    expect(remocoes, [
      {'id': 5}
    ]);
    expect(find.text(_recusa), findsOneWidget);
    expect(find.text('Houve um erro, tente novamente!'), findsNothing);
  });

  testWidgets('erro técnico: texto genérico', (tester) async {
    servir(() => http.Response(jsonEncode({'message': 'PrismaClientKnownRequestError'}), 500, headers: _json));
    await excluir(tester);
    expect(find.text('Houve um erro, tente novamente!'), findsOneWidget);
  });
}
