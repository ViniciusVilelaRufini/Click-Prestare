import 'dart:convert';

import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_details_page.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  tearDown(ApiClient.restaurarPadroes);

  testWidgets('apresenta o status e não mostra campos internos do entregador',
      (tester) async {
    final aviso = DeliveryModel.fromJson({
      'id': 7,
      'status': 'AUTORIZADA',
      'estabelecimento': 'Mercado',
      'modo_entrega': 'UNIDADE',
      'entregador': {
        'nome': 'João',
        'documento': '123.456.789-00',
        'status': 'BLOQUEADO',
        'motivo_bloqueio': 'Registro interno',
      },
      'eventos': [
        {'status_novo': 'AGENDADA', 'created_at': '2026-09-27T18:00:00.000Z'},
        {'status_novo': 'AUTORIZADA', 'created_at': '2026-09-27T18:10:00.000Z'},
      ],
    });

    await tester
        .pumpWidget(MaterialApp(home: DeliveryDetailsPage(delivery: aviso)));

    expect(find.text('Entrega autorizada'), findsWidgets);
    expect(find.text('123.456.789-00'), findsNothing);
    expect(find.text('Registro interno'), findsNothing);
    expect(find.text('Cancelar aviso'), findsNothing);
  });

  testWidgets(
      'mantém os detalhes abertos e não notifica mudança quando o cancelamento falha',
      (tester) async {
    var changes = 0;
    ApiClient.client = MockClient((_) async {
      return http.Response(
          jsonEncode({'message': 'Cancelamento indisponível'}), 500);
    });

    await tester.pumpWidget(MaterialApp(
      home: DeliveryDetailsPage(
        delivery: const DeliveryModel(id: 7),
        onChanged: () => changes++,
      ),
    ));

    await tester.tap(find.text('Cancelar aviso'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sim'));
    await tester.pumpAndSettle();

    expect(changes, 0);
    expect(find.byType(DeliveryDetailsPage), findsOneWidget);
    expect(find.text('Cancelamento indisponível'), findsOneWidget);
  });

  group('aguardando autorização', () {
    const aguardando = DeliveryModel(id: 7, status: 'AGUARDANDO_AUTORIZACAO');

    testWidgets('oferece autorizar e recusar, e não cancelar', (tester) async {
      await tester.pumpWidget(
          const MaterialApp(home: DeliveryDetailsPage(delivery: aguardando)));

      expect(find.text('Autorizar entrega'), findsOneWidget);
      expect(find.text('Recusar'), findsOneWidget);
      expect(find.text('Cancelar aviso'), findsNothing);
    });

    testWidgets('autorizar envia AUTORIZADA e avisa a lista', (tester) async {
      var changes = 0;
      Map<String, dynamic>? enviado;
      ApiClient.client = MockClient((req) async {
        enviado = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'id': 7, 'status': 'AUTORIZADA'}), 200);
      });

      await tester.pumpWidget(MaterialApp(
        home: DeliveryDetailsPage(delivery: aguardando, onChanged: () => changes++),
      ));
      await tester.tap(find.text('Autorizar entrega'));
      await tester.pumpAndSettle();

      expect(enviado, {'status': 'AUTORIZADA'});
      expect(changes, 1);
    });

    testWidgets('recusar envia RECUSADA com motivo', (tester) async {
      Map<String, dynamic>? enviado;
      ApiClient.client = MockClient((req) async {
        enviado = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response(jsonEncode({'id': 7, 'status': 'RECUSADA'}), 200);
      });

      await tester.pumpWidget(
          const MaterialApp(home: DeliveryDetailsPage(delivery: aguardando)));
      await tester.tap(find.text('Recusar'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sim'));
      await tester.pumpAndSettle();

      expect(enviado, {'status': 'RECUSADA', 'motivo': 'Recusada pelo morador.'});
    });
  });
}
