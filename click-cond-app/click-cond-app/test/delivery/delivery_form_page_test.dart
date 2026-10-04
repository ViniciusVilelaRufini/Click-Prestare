import 'dart:convert';

import 'package:click/pages/shared/delivery/delivery_form_page.dart';
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

  testWidgets(
      'envia dados opcionais do entregador e mantém o formulário aberto quando a criação falha',
      (tester) async {
    late http.Request request;
    ApiClient.client = MockClient((captured) async {
      if (captured.method == 'GET' &&
          captured.url.path == '/api/delivery/unidades') {
        return http.Response(
            jsonEncode([
              {'id': 77, 'bloco': 'A', 'apto': '101'},
            ]),
            200);
      }
      request = captured;
      return http.Response(jsonEncode({'message': 'Aviso não criado'}), 500);
    });

    await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Nome do entregador (opcional)'),
      'João da Silva',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Telefone do entregador (opcional)'),
      '(11) 99999-9999',
    );
    await tester.ensureVisible(find.text('Criar aviso'));
    await tester.tap(find.text('Criar aviso'));
    await tester.pumpAndSettle();

    final payload = jsonDecode(request.body) as Map<String, dynamic>;
    expect(payload['id_apartamento'], 77);
    expect(payload['nome_entregador'], 'João da Silva');
    expect(payload['telefone_entregador'], '(11) 99999-9999');
    expect(find.byType(DeliveryFormPage), findsOneWidget);
    expect(find.text('Erro'), findsOneWidget);
    expect(find.text('Aviso não criado'), findsOneWidget);
  });

  testWidgets(
      'exige escolha explícita quando o morador possui mais de uma unidade',
      (tester) async {
    var posts = 0;
    ApiClient.client = MockClient((request) async {
      if (request.method == 'GET') {
        return http.Response(
            jsonEncode([
              {'id': 101, 'bloco': 'A', 'apto': '101'},
              {'id': 202, 'bloco': 'B', 'apto': '202'},
            ]),
            200);
      }
      posts++;
      return http.Response(jsonEncode({'id': 99, 'status': 'AGENDADA'}), 201);
    });

    await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Criar aviso'));
    await tester.tap(find.text('Criar aviso'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('delivery-unit-selector')), findsOneWidget);
    expect(posts, 0);
    expect(find.text('Selecione a unidade do aviso.'), findsOneWidget);
  });

  testWidgets('envia a unidade escolhida entre múltiplos vínculos',
      (tester) async {
    http.Request? postRequest;
    ApiClient.client = MockClient((request) async {
      if (request.method == 'GET') {
        return http.Response(
            jsonEncode([
              {'id': 101, 'bloco': 'A', 'apto': '101'},
              {'id': 202, 'bloco': 'B', 'apto': '202'},
            ]),
            200);
      }
      postRequest = request;
      return http.Response(jsonEncode({'message': 'Aviso não criado'}), 500);
    });

    await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delivery-unit-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bloco B · Unidade 202').last);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Criar aviso'));
    await tester.tap(find.text('Criar aviso'));
    await tester.pumpAndSettle();

    expect(postRequest, isNotNull);
    final payload = jsonDecode(postRequest!.body) as Map<String, dynamic>;
    expect(payload['id_apartamento'], 202);
  });
  group('layout em seções', () {
    http.Request? postRequest;

    setUp(() {
      postRequest = null;
      ApiClient.client = MockClient((request) async {
        if (request.method == 'GET') {
          return http.Response(
              jsonEncode([
                {'id': 77, 'bloco': 'A', 'apto': '101'},
              ]),
              200);
        }
        postRequest = request;
        return http.Response(jsonEncode({'message': 'Aviso não criado'}), 500);
      });
    });

    testWidgets('mostra os títulos das seções e a unidade única',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      for (final titulo in [
        'Unidade',
        'Sobre a entrega',
        'Entregador (opcional)',
        'Como receber',
        'Observação',
      ]) {
        expect(find.text(titulo), findsOneWidget, reason: titulo);
      }
      expect(find.byKey(const Key('delivery-unit-single')), findsOneWidget);
    });

    testWidgets('modo de entrega em cards: começa na unidade e troca para portaria',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      expect(find.text('O entregador sobe até o seu apartamento'), findsOneWidget);
      expect(find.text('Você retira na portaria'), findsOneWidget);
      expect(
          tester.getSemantics(find.byKey(const Key('delivery-mode-unidade'))),
          isSemantics(isSelected: true, isButton: true, hasTapAction: true));
      expect(
          tester.getSemantics(find.byKey(const Key('delivery-mode-portaria'))),
          isSemantics(isSelected: false, isButton: true, hasTapAction: true));

      await tester.ensureVisible(find.byKey(const Key('delivery-mode-portaria')));
      await tester.tap(find.byKey(const Key('delivery-mode-portaria')));
      await tester.pumpAndSettle();

      expect(
          tester.getSemantics(find.byKey(const Key('delivery-mode-portaria'))),
          isSemantics(isSelected: true));

      await tester.tap(find.text('Criar aviso'));
      await tester.pumpAndSettle();

      final payload = jsonDecode(postRequest!.body) as Map<String, dynamic>;
      expect(payload['modo_entrega'], 'PORTARIA');
    });

    testWidgets('sem trocar o modo envia UNIDADE', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Criar aviso'));
      await tester.pumpAndSettle();

      final payload = jsonDecode(postRequest!.body) as Map<String, dynamic>;
      expect(payload['modo_entrega'], 'UNIDADE');
      expect(payload.containsKey('previsao_em'), isFalse);
    });

    testWidgets('previsão: escolhe data e hora, mostra e limpa', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      expect(find.text('Toque para escolher data e hora'), findsOneWidget);
      expect(find.byTooltip('Limpar previsão'), findsNothing);

      await tester.tap(find.byKey(const Key('delivery-forecast-field')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      expect(find.text('Toque para escolher data e hora'), findsNothing);
      expect(find.byTooltip('Limpar previsão'), findsOneWidget);

      await tester.tap(find.byTooltip('Limpar previsão'));
      await tester.pumpAndSettle();
      expect(find.text('Toque para escolher data e hora'), findsOneWidget);
    });

    testWidgets('renderiza no tema escuro em tela estreita sem estouro',
        (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 640 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(MaterialApp(
          theme: ThemeData.dark(), home: const DeliveryFormPage()));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Criar aviso'), findsOneWidget);
    });
  });
}
