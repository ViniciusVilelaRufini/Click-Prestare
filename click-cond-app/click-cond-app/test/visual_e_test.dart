import 'dart:convert';

import 'package:click/pages/shared/docs/list_atas.dart';
import 'package:click/pages/shared/docs/list_docs.dart';
import 'package:click/pages/shared/mudancas/list_mudancas.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_filtro_chip.dart';
import 'package:click/widgets/app/app_filtro_meses.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  void servir(Map<String, dynamic> porRota) {
    ApiClient.client = MockClient((request) async {
      for (final e in porRota.entries) {
        if (request.url.path.contains(e.key)) {
          return http.Response(jsonEncode(e.value), 200,
              headers: {'content-type': 'application/json; charset=utf-8'});
        }
      }
      return http.Response('', 404);
    });
  }

  test('ultimosMeses devolve 12 meses do atual para trás', () {
    final m = ultimosMeses(agora: DateTime(2026, 2, 15));
    expect(m.length, 12);
    expect(rotuloMesFiltro(m.first), 'Fevereiro / 2026');
    expect(rotuloMesFiltro(m[2]), 'Dezembro / 2025');
  });

  test('formatarDataAta e solicitante/unidade da mudança', () {
    expect(formatarDataAta('2026-11-12T15:00:00.000Z'), '12/11/2026');
    expect(formatarDataAta(null), '');
    expect(mudancaRotuloUnidade('A', '106'), 'Bloco A · Apto 106');
    expect(mudancaRotuloUnidade(null, '106'), 'Apto 106');
    expect(mudancaRotuloUnidade(null, null), 'Mudança');
    expect(mudancaSolicitante({'criadoPor': {'name': 'MARIA DA SILVA'}}), 'Maria da Silva');
    expect(mudancaSolicitante({}), '');
  });

  testWidgets('Documentos: atalhos primeiro e vazio específico, sem "Nenhum registro"', (tester) async {
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    servir({'documentos/get-all': []});
    await tester.pumpWidget(const MaterialApp(home: ListDocs()));
    await tester.pumpAndSettle();

    expect(find.text('Nenhum registro encontrado!'), findsNothing);
    expect(find.text('Atas'), findsOneWidget);
    expect(find.text('Nenhum documento enviado ainda.'), findsOneWidget);
    expect(find.byType(AppFiltroChip), findsWidgets);
    expect(tester.getTopLeft(find.text('Atas')).dy,
        lessThan(tester.getTopLeft(find.text('Nenhum documento enviado ainda.')).dy));

    await tester.tap(find.text('TODOS OS MESES'));
    await tester.tap(find.byType(AppFiltroChip).at(1));
    await tester.pumpAndSettle();
    expect(find.text('Nenhum documento neste período.'), findsOneWidget);
  });

  testWidgets('Atas mostra a data de cada ata', (tester) async {
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
    final agora = DateTime.now().toUtc().add(const Duration(hours: 12));
    servir({
      'documentos/get-all': [
        {'id': 1, 'nome': 'Ata geral', 'link_doc': 'x', 'created_at': agora.toIso8601String()}
      ]
    });
    await tester.pumpWidget(const MaterialApp(home: ListAtas()));
    await tester.pumpAndSettle();
    expect(find.text('Ata geral'), findsOneWidget);
    expect(find.text(formatarDataAta(agora.toIso8601String())), findsOneWidget);
  });
}
