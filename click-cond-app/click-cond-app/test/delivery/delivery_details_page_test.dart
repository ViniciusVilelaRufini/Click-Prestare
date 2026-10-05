import 'dart:convert';

import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_details_page.dart';
import 'package:click/pages/shared/delivery/delivery_form_page.dart';
import 'package:click/pages/shared/delivery/delivery_status_style.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Monta a página com "reduzir movimento" ligado por padrão: o anel pulsante
/// do status ativo é uma animação contínua e o pumpAndSettle não terminaria.
Widget app(Widget home, {bool reduceMotion = true, ThemeData? theme}) =>
    MaterialApp(
      theme: theme,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
        child: child!,
      ),
      home: home,
    );

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

    await tester.pumpWidget(app(DeliveryDetailsPage(delivery: aviso)));

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

    await tester.pumpWidget(app(DeliveryDetailsPage(
      delivery: const DeliveryModel(id: 7),
      onChanged: () => changes++,
    )));

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
      await tester
          .pumpWidget(app(const DeliveryDetailsPage(delivery: aguardando)));

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

      await tester.pumpWidget(app(
          DeliveryDetailsPage(delivery: aguardando, onChanged: () => changes++)));
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

      await tester
          .pumpWidget(app(const DeliveryDetailsPage(delivery: aguardando)));
      await tester.tap(find.text('Recusar'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sim'));
      await tester.pumpAndSettle();

      expect(enviado, {'status': 'RECUSADA', 'motivo': 'Recusada pelo morador.'});
    });
  });

  group('barra de ações fixa', () {
    Finder naBarra(String texto) => find.descendant(
        of: find.byKey(const Key('delivery-actions-bar')),
        matching: find.text(texto));

    testWidgets('aguardando autorização: autorizar e recusar na barra',
        (tester) async {
      await tester.pumpWidget(app(const DeliveryDetailsPage(
          delivery: DeliveryModel(id: 7, status: 'AGUARDANDO_AUTORIZACAO'))));

      expect(naBarra('Autorizar entrega'), findsOneWidget);
      expect(naBarra('Recusar'), findsOneWidget);
      expect(naBarra('Cancelar aviso'), findsNothing);
      expect(naBarra('Avisar nova entrega'), findsNothing);
    });

    testWidgets('agendada: só cancelar aviso na barra', (tester) async {
      await tester.pumpWidget(app(const DeliveryDetailsPage(
          delivery: DeliveryModel(id: 7, status: 'AGENDADA'))));

      expect(naBarra('Cancelar aviso'), findsOneWidget);
      expect(find.text('Autorizar entrega'), findsNothing);
      expect(find.text('Avisar nova entrega'), findsNothing);
    });

    for (final status in ['CHEGOU', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA']) {
      testWidgets('$status: sem barra de ações', (tester) async {
        await tester.pumpWidget(app(
            DeliveryDetailsPage(delivery: DeliveryModel(id: 7, status: status))));

        expect(find.byKey(const Key('delivery-actions-bar')), findsNothing);
      });
    }

    for (final status in ['CONCLUIDA', 'CANCELADA', 'RECUSADA']) {
      testWidgets('$status: só "Avisar nova entrega" na barra', (tester) async {
        await tester.pumpWidget(app(
            DeliveryDetailsPage(delivery: DeliveryModel(id: 7, status: status))));

        expect(naBarra('Avisar nova entrega'), findsOneWidget);
        expect(find.text('Cancelar aviso'), findsNothing);
        expect(find.text('Autorizar entrega'), findsNothing);
      });
    }
  });

  testWidgets('"Avisar nova entrega" abre o formulário com o estabelecimento',
      (tester) async {
    await tester.pumpWidget(app(const DeliveryDetailsPage(
        delivery: DeliveryModel(
            id: 7, status: 'CONCLUIDA', estabelecimento: 'Pizzaria Central'))));

    await tester.tap(find.text('Avisar nova entrega'));
    await tester.pumpAndSettle();

    expect(find.byType(DeliveryFormPage), findsOneWidget);
    final campo =
        find.widgetWithText(TextFormField, 'Estabelecimento (opcional)');
    expect(tester.widget<TextFormField>(campo).controller!.text,
        'Pizzaria Central');
  });

  testWidgets('mostra as etapas do fluxo em andamento com o horário de cada uma',
      (tester) async {
    final chegada =
        DateTime.now().subtract(const Duration(minutes: 5)).toIso8601String();
    await tester.pumpWidget(app(DeliveryDetailsPage(
        delivery: DeliveryModel(id: 7, status: 'CHEGOU', eventos: [
      DeliveryEvent(statusNovo: 'CHEGOU', createdAt: chegada),
    ]))));

    for (final etapa in ['Aviso', 'Chegou', 'Autorização', 'Concluída']) {
      expect(find.text(etapa), findsWidgets, reason: etapa);
    }
    expect(find.text(formatStepTime(chegada)), findsOneWidget);
    expect(find.text('Chegou há 5 min'), findsOneWidget);
  });

  testWidgets('título é o estabelecimento e o status vira selo', (tester) async {
    await tester.pumpWidget(app(const DeliveryDetailsPage(
        delivery: DeliveryModel(
            id: 7, status: 'CHEGOU', estabelecimento: 'Hamburgueria'))));

    expect(find.text('Hamburgueria'), findsWidgets);
    expect(
        find.descendant(
            of: find.byType(DeliveryStatusBadge),
            matching: find.text('Chegou')),
        findsOneWidget);
  });

  group('O que acontece agora?', () {
    for (final status in [
      'AGENDADA',
      'CHEGOU',
      'AGUARDANDO_AUTORIZACAO',
      'AUTORIZADA',
      'RETIRADA_NA_PORTARIA',
      'CONCLUIDA',
      'CANCELADA',
      'RECUSADA',
    ]) {
      testWidgets(status, (tester) async {
        final aviso = DeliveryModel(id: 7, status: status);
        await tester.pumpWidget(app(DeliveryDetailsPage(delivery: aviso)));

        expect(find.text('O que acontece agora?'), findsOneWidget);
        expect(find.text(deliveryNextStep(aviso).text), findsOneWidget);
      });
    }
  });

  testWidgets('recusada: faixa "Encerrada" com o motivo e sem etapas',
      (tester) async {
    await tester.pumpWidget(app(const DeliveryDetailsPage(
        delivery: DeliveryModel(
            id: 7, status: 'RECUSADA', motivo: 'Entregador sem identificação'))));

    expect(find.text('Entrega recusada'), findsWidgets);
    expect(find.text('Encerrada'), findsOneWidget);
    expect(find.text('Entregador sem identificação'), findsOneWidget);
    expect(find.text('Autorização'), findsNothing);
  });

  testWidgets('detalhes só mostram os blocos que têm conteúdo', (tester) async {
    await tester.pumpWidget(app(const DeliveryDetailsPage(
        delivery: DeliveryModel(id: 7, status: 'AGENDADA'))));
    expect(find.text('Previsão'), findsNothing);
    expect(find.text('Observação'), findsNothing);
    expect(find.text('Tipo de entrega'), findsOneWidget);

    await tester.pumpWidget(app(const DeliveryDetailsPage(
        delivery: DeliveryModel(
            id: 8,
            status: 'AGENDADA',
            previsaoEm: '2026-10-04T19:45:00',
            observacaoMorador: 'Interfone quebrado'))));
    expect(find.text('Previsão'), findsOneWidget);
    expect(find.text('Observação'), findsOneWidget);
    expect(find.text('Interfone quebrado'), findsOneWidget);
  });

  testWidgets('linha do tempo com o evento mais recente no topo',
      (tester) async {
    await tester.pumpWidget(app(const DeliveryDetailsPage(
        delivery: DeliveryModel(id: 7, status: 'CHEGOU', eventos: [
      DeliveryEvent(statusNovo: 'AGENDADA', createdAt: '2026-10-04T18:00:00'),
      DeliveryEvent(statusNovo: 'CHEGOU', createdAt: '2026-10-04T18:20:00'),
    ]))));

    final recente = tester.getRect(find.text('Entregador chegou'));
    final antigo = tester.getRect(find.text('Aviso agendado'));
    expect(recente.top, lessThan(antigo.top));
  });

  group('anel pulsante do status', () {
    testWidgets('pulsa enquanto o aviso está em andamento', (tester) async {
      await tester.pumpWidget(app(
          const DeliveryDetailsPage(delivery: DeliveryModel(id: 7, status: 'CHEGOU')),
          reduceMotion: false));
      await tester.pump(const Duration(seconds: 2));

      expect(find.byKey(const Key('delivery-hero-pulse')), findsOneWidget);
      expect(tester.hasRunningAnimations, isTrue);
    });

    testWidgets('não pulsa com "reduzir movimento"', (tester) async {
      await tester.pumpWidget(app(
          const DeliveryDetailsPage(delivery: DeliveryModel(id: 7, status: 'CHEGOU'))));
      await tester.pump(const Duration(seconds: 2));

      expect(find.byKey(const Key('delivery-hero-pulse')), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    });

    testWidgets('não pulsa em aviso encerrado', (tester) async {
      await tester.pumpWidget(app(
          const DeliveryDetailsPage(
              delivery: DeliveryModel(id: 7, status: 'CONCLUIDA')),
          reduceMotion: false));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('delivery-hero-pulse')), findsNothing);
    });
  });

  testWidgets('renderiza no tema escuro em tela estreita sem estouro',
      (tester) async {
    tester.view.physicalSize = const Size(320 * 3, 640 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final aviso = DeliveryModel.fromJson({
      'id': 7,
      'status': 'AGUARDANDO_AUTORIZACAO',
      'estabelecimento': 'Supermercado com um nome bastante comprido',
      'modo_entrega': 'PORTARIA',
      'previsao_em': '2026-10-04T19:45:00.000',
      'observacao_morador': 'Interfone com defeito, favor ligar no celular',
      'eventos': [
        {'status_novo': 'AGENDADA', 'created_at': '2026-10-04T18:00:00.000'},
        {'status_novo': 'CHEGOU', 'created_at': '2026-10-04T18:10:00.000'},
        {
          'status_novo': 'AGUARDANDO_AUTORIZACAO',
          'created_at': '2026-10-04T18:11:00.000',
          'mensagem': 'Portaria pediu autorização'
        },
      ],
    });

    await tester.pumpWidget(
        app(DeliveryDetailsPage(delivery: aviso), theme: ThemeData.dark()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Portaria pediu autorização'), findsOneWidget);
  });
}
