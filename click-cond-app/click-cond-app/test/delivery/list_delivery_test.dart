import 'dart:convert';

import 'package:click/pages/shared/delivery/list_delivery.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  setUp(() {
    Singleton.instance.id_condominio = 11;
    Singleton.instance.id_apartamento = 22;
    ApiClient.tokenProvider = () => 'sessao-do-morador';
  });

  tearDown(() {
    ApiClient.restaurarPadroes();
    Singleton.instance.reset();
  });

  Map<String, dynamic> aviso(int id, String status, String estabelecimento,
          {String? observacao, String modo = 'UNIDADE'}) =>
      {
        'id': id,
        'status': status,
        'estabelecimento': estabelecimento,
        'modo_entrega': modo,
        'created_at': '2026-10-0${id}T12:00:00.000',
        if (observacao != null) 'observacao_morador': observacao,
      };

  testWidgets('separa ativas e histórico com contagens e mostra o pedido de resposta',
      (tester) async {
    ApiClient.client = MockClient((_) async => http.Response(
        jsonEncode([
          aviso(1, 'AGUARDANDO_AUTORIZACAO', 'Mercado Bom Preço'),
          aviso(2, 'CHEGOU', 'Farmácia', modo: 'PORTARIA', observacao: 'Remédio'),
          aviso(3, 'CONCLUIDA', 'Pizzaria'),
        ]),
        200));

    await tester.pumpWidget(const MaterialApp(home: ListDelivery()));
    await tester.pumpAndSettle();

    expect(find.text('Ativas (2)'), findsOneWidget);
    expect(find.text('Histórico (1)'), findsOneWidget);
    expect(find.text('A portaria aguarda sua resposta'), findsOneWidget);
    expect(find.textContaining('Mercado Bom Preço'), findsOneWidget);
    expect(find.text('Farmácia'), findsOneWidget);
    expect(find.text('Na portaria'), findsOneWidget);
    expect(find.text('Remédio'), findsOneWidget);
    expect(find.text('Pizzaria'), findsNothing);

    await tester.tap(find.text('Histórico (1)'));
    await tester.pumpAndSettle();
    expect(find.text('Pizzaria'), findsOneWidget);
    expect(find.text('Concluída'), findsOneWidget);
  });

  testWidgets('não mostra o pedido de resposta quando nada aguarda o morador',
      (tester) async {
    ApiClient.client = MockClient((_) async => http.Response(
        jsonEncode([aviso(1, 'AGENDADA', 'Padaria')]), 200));

    await tester.pumpWidget(const MaterialApp(home: ListDelivery()));
    await tester.pumpAndSettle();

    expect(find.text('Ativas (1)'), findsOneWidget);
    expect(find.text('Histórico (0)'), findsOneWidget);
    expect(find.text('A portaria aguarda sua resposta'), findsNothing);
    expect(find.text('Padaria'), findsOneWidget);
  });

  testWidgets('autorizar pelo destaque envia AUTORIZADA e recarrega a lista',
      (tester) async {
    var gets = 0;
    Map<String, dynamic>? enviado;
    ApiClient.client = MockClient((req) async {
      if (req.method == 'PATCH') {
        enviado = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'id': 1, 'status': 'AUTORIZADA'}), 200);
      }
      gets++;
      return http.Response(
          jsonEncode([
            aviso(1, gets == 1 ? 'AGUARDANDO_AUTORIZACAO' : 'AUTORIZADA',
                'Mercado'),
          ]),
          200);
    });

    await tester.pumpWidget(const MaterialApp(home: ListDelivery()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Autorizar'));
    await tester.pumpAndSettle();

    expect(enviado, {'status': 'AUTORIZADA'});
    expect(gets, 2);
    expect(find.text('Entrega autorizada.'), findsOneWidget);
    expect(find.text('A portaria aguarda sua resposta'), findsNothing);
  });

  testWidgets('recusar pelo destaque pede confirmação antes de enviar',
      (tester) async {
    Map<String, dynamic>? enviado;
    ApiClient.client = MockClient((req) async {
      if (req.method == 'PATCH') {
        enviado = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'id': 1, 'status': 'RECUSADA'}), 200);
      }
      return http.Response(
          jsonEncode([aviso(1, 'AGUARDANDO_AUTORIZACAO', 'Mercado')]), 200);
    });

    await tester.pumpWidget(const MaterialApp(home: ListDelivery()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Recusar'));
    await tester.pumpAndSettle();
    expect(enviado, isNull);
    await tester.tap(find.text('Sim'));
    await tester.pumpAndSettle();

    expect(enviado, {'status': 'RECUSADA', 'motivo': 'Recusada pelo morador.'});
  });

  testWidgets('estados vazios por aba', (tester) async {
    ApiClient.client =
        MockClient((_) async => http.Response(jsonEncode([]), 200));

    await tester.pumpWidget(const MaterialApp(home: ListDelivery()));
    await tester.pumpAndSettle();

    expect(find.text('Nenhuma entrega em andamento'), findsOneWidget);
    await tester.tap(find.text('Histórico (0)'));
    await tester.pumpAndSettle();
    expect(find.text('Nenhuma entrega no histórico'), findsOneWidget);
  });

  testWidgets('embutida sem app bar e sem FAB continua montando as abas',
      (tester) async {
    ApiClient.client = MockClient((_) async => http.Response(
        jsonEncode([aviso(1, 'AGENDADA', 'Padaria')]), 200));

    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: ListDelivery(hideAppBar: true, showFab: false))));
    await tester.pumpAndSettle();

    expect(find.text('Ativas (1)'), findsOneWidget);
    expect(find.byType(FloatingActionButton), findsNothing);
  });
  testWidgets('cabe em tela estreita no tema escuro sem estourar o layout',
      (tester) async {
    tester.view.physicalSize = const Size(320 * 3, 640 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    ApiClient.client = MockClient((_) async => http.Response(
        jsonEncode([
          aviso(1, 'AGUARDANDO_AUTORIZACAO', 'Supermercado com nome bem comprido'),
          aviso(2, 'RETIRADA_NA_PORTARIA', 'Loja de departamentos muito longa',
              modo: 'PORTARIA', observacao: 'Deixar com o porteiro da noite, obrigado'),
        ]),
        200));

    await tester.pumpWidget(MaterialApp(
        theme: ThemeData.dark(), home: const ListDelivery()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('A portaria aguarda sua resposta'), findsOneWidget);
  });
}
