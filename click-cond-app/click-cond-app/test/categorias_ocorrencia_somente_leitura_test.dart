import 'dart:convert';

import 'package:click/pages/shared/ocorrencias/list_categorias_ocorrencia.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

/// A API recusa criar/editar/excluir categoria pelo app (403: "As categorias
/// são definidas pela Prestare."). A tela virou consulta.
void main() {
  late List<String> metodos;

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
    metodos = [];
    ApiClient.client = MockClient((req) async {
      metodos.add('${req.method} ${req.url.path}');
      if (req.url.path.endsWith('/ocorrencias/categorias/get-all')) {
        return http.Response(
          jsonEncode([
            {'id': 1, 'nome': 'Barulho', 'prioridade': 1, 'sla_horas': 24},
            {'id': 2, 'nome': 'Vazamento', 'prioridade': 0, 'sla_horas': null},
          ]),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      return http.Response('', 404);
    });
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  testWidgets('lista as categorias sem criar, editar nem excluir', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: ListCategoriasOcorrencia()));
    await tester.pumpAndSettle();

    expect(find.text('Barulho'), findsOneWidget);
    expect(find.text('Vazamento'), findsOneWidget);
    expect(find.text('As categorias são definidas pela Prestare.'), findsOneWidget);
    expect(find.byType(FloatingActionButton), findsNothing);
    expect(find.byIcon(PhosphorIcons.trash), findsNothing);

    // Tocar no item não abre editor.
    await tester.tap(find.text('Barulho'));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(metodos.where((m) => !m.startsWith('GET')), isEmpty);
  });
}
