import 'dart:convert';

import 'package:click/pages/shared/encomendas/list_encomendas.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

String _iso(Duration atras) =>
    DateTime.now().subtract(atras).toIso8601String();

List<Map<String, dynamic>> _encomendas() => [
      {
        'id': 1,
        'descricao': 'Caixa da Amazon',
        'destinatario_bloco': 'A',
        'destinatario_apto': '106',
        'recebido_de': 'Amazon',
        'recebido_em': _iso(const Duration(days: 2)),
        'status': 'aguardando',
      },
      {
        'id': 2,
        'descricao': 'Envelope',
        'destinatario_bloco': 'A',
        'destinatario_apto': '106',
        'recebido_de': null,
        'recebido_em': _iso(const Duration(hours: 3)),
        'status': 'aguardando',
      },
      {
        'id': 3,
        'descricao': 'Livro',
        'destinatario_bloco': 'A',
        'destinatario_apto': '106',
        'recebido_de': 'Correios',
        'recebido_em': _iso(const Duration(days: 3)),
        'retirado_em': _iso(const Duration(days: 1)),
        'retirado_por': 'Maria',
        'status': 'retirado',
      },
    ];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    Singleton.instance.id_condominio = 11;
    ApiClient.client = MockClient(
        (_) async => http.Response(jsonEncode(_encomendas()), 200));
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  void comoMorador() => storageMorador({
        'token': 't',
        'user': {'id': 1, 'nome': 'Ana'},
      });

  void comoFuncionario() => storageFuncionario({
        'token': 't',
        'user': {'id': 7, 'nome': 'Porteiro'},
      });

  Future<void> abrir(WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: ListEncomendas()));
    await tester.pumpAndSettle();
  }

  testWidgets('seletor segmentado com contagens no lugar dos chips',
      (tester) async {
    comoMorador();
    await abrir(tester);

    expect(find.text('TODAS (3)'), findsOneWidget);
    expect(find.text('AGUARDANDO (2)'), findsOneWidget);
    expect(find.text('ENTREGUES (1)'), findsOneWidget);
    expect(find.byType(FilterChip), findsNothing);

    await tester.tap(find.text('ENTREGUES (1)'));
    await tester.pumpAndSettle();
    expect(find.text('Livro'), findsOneWidget);
    expect(find.text('Caixa da Amazon'), findsNothing);
  });

  testWidgets('card que aguarda mostra há quanto tempo está na portaria',
      (tester) async {
    comoMorador();
    await abrir(tester);

    expect(find.text('Aguardando retirada (2)'), findsOneWidget);
    expect(find.text('Na portaria há 2 dias'), findsOneWidget);
    expect(find.text('Na portaria há 3 h'), findsOneWidget);
    expect(find.textContaining('Amazon · chegou'), findsOneWidget);
    // Sem remetente não aparece "Transportadora: N/A".
    expect(find.textContaining('Transportadora'), findsNothing);
    expect(find.textContaining('N/A'), findsNothing);
  });

  testWidgets('card entregue mostra quem retirou e quando', (tester) async {
    comoMorador();
    await abrir(tester);

    // Nome e data em linhas separadas (o nome não é cortado pela data).
    expect(find.text('Retirada por Maria'), findsOneWidget);
    expect(find.textContaining('ontem às '), findsOneWidget);
    expect(find.text('Entregues (1)'), findsOneWidget);
    expect(find.text('Ontem'), findsOneWidget);
    expect(tester.getTopLeft(find.text('Entregues (1)')).dy,
        lessThan(tester.getTopLeft(find.text('Ontem')).dy));
  });

  testWidgets('morador com uma unidade não vê o selo da unidade',
      (tester) async {
    comoMorador();
    await abrir(tester);

    expect(find.textContaining('Apto 106'), findsNothing);
  });

  testWidgets('equipe vê o selo da unidade e as ações do card',
      (tester) async {
    tester.view.physicalSize = const Size(800, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    comoFuncionario();
    await abrir(tester);

    expect(find.text('Bloco A • Apto 106'), findsWidgets);
    expect(find.text('Dar Baixa'), findsNWidgets(2));
    expect(find.text('Editar'), findsNWidgets(3));
  });

  testWidgets('tocar no card abre os detalhes e tem rótulo acessível',
      (tester) async {
    comoMorador();
    await abrir(tester);

    expect(
        tester.getSemantics(find.text('Caixa da Amazon')),
        isSemantics(
            isButton: true,
            hasTapAction: true,
            label: 'Caixa da Amazon, Na portaria há 2 dias'));
    await tester.tap(find.text('Caixa da Amazon'));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsOneWidget);
  });

  testWidgets('estado vazio por filtro', (tester) async {
    comoMorador();
    ApiClient.client = MockClient((_) async => http.Response(
        jsonEncode([_encomendas()[2]]), 200));
    await abrir(tester);

    await tester.tap(find.text('AGUARDANDO (0)'));
    await tester.pumpAndSettle();
    expect(find.text('Nada aguardando retirada'), findsOneWidget);
  });

  testWidgets('cabe em tela estreita no tema escuro', (tester) async {
    tester.view.physicalSize = const Size(320 * 3, 640 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    comoFuncionario();
    await tester.pumpWidget(
        MaterialApp(theme: ThemeData.dark(), home: const ListEncomendas()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });
}
