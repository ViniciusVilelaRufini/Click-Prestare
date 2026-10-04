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
    await tester.pumpAndSettle();
    // Entregador e observação ficam em "Mais detalhes", recolhido no início.
    await tester.ensureVisible(find.text('Mais detalhes (opcional)'));
    await tester.tap(find.text('Mais detalhes (opcional)'));
    await tester.pumpAndSettle();

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

    Future<Map<String, dynamic>> criar(WidgetTester tester) async {
      await tester.tap(find.text('Criar aviso'));
      await tester.pumpAndSettle();
      return jsonDecode(postRequest!.body) as Map<String, dynamic>;
    }

    Future<void> tocar(WidgetTester tester, Finder alvo) async {
      await tester.ensureVisible(alvo);
      await tester.pumpAndSettle();
      await tester.tap(alvo);
      await tester.pumpAndSettle();
    }

    testWidgets('mostra só o essencial; entregador e observação ficam recolhidos',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      for (final titulo in [
        'Unidade',
        'Sobre a entrega',
        'Quando chega?',
        'Como receber',
        'Mais detalhes (opcional)',
      ]) {
        expect(find.text(titulo), findsOneWidget, reason: titulo);
      }
      expect(find.byKey(const Key('delivery-unit-single')), findsOneWidget);
      expect(find.text('Nome do entregador (opcional)'), findsNothing);
      expect(find.text('Observação (opcional)'), findsNothing);

      await tocar(tester, find.text('Mais detalhes (opcional)'));

      expect(find.text('Entregador'), findsOneWidget);
      expect(find.text('Observação'), findsOneWidget);
      expect(find.text('Nome do entregador (opcional)'), findsOneWidget);
      expect(find.text('Observação (opcional)'), findsOneWidget);
    });

    testWidgets('recolher "Mais detalhes" mantém o que foi digitado e mostra o resumo',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();
      await tocar(tester, find.text('Mais detalhes (opcional)'));
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Nome do entregador (opcional)'),
          'João');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Observação (opcional)'),
          'Interfone quebrado');
      await tocar(tester, find.text('Mais detalhes (opcional)'));

      expect(find.text('Nome do entregador (opcional)'), findsNothing);
      expect(find.text('João · com observação'), findsOneWidget);

      final payload = await criar(tester);
      expect(payload['nome_entregador'], 'João');
      expect(payload['observacao_morador'], 'Interfone quebrado');
    });

    testWidgets('atalhos de estabelecimento preenchem o campo e ficam destacados',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      for (final atalho in ['iFood', 'Rappi', 'Mercado Livre', 'Farmácia', 'Mercado']) {
        expect(find.widgetWithText(ChoiceChip, atalho), findsOneWidget, reason: atalho);
      }

      await tocar(tester, find.widgetWithText(ChoiceChip, 'iFood'));
      final campo = find.widgetWithText(TextFormField, 'Estabelecimento (opcional)');
      expect(tester.widget<TextFormField>(campo).controller!.text, 'iFood');
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'iFood')).selected,
          isTrue);

      await tocar(tester, find.widgetWithText(ChoiceChip, 'Farmácia'));
      expect(tester.widget<TextFormField>(campo).controller!.text, 'Farmácia');
      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'iFood')).selected,
          isFalse);

      final payload = await criar(tester);
      expect(payload['estabelecimento'], 'Farmácia');
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

      await tocar(tester, find.byKey(const Key('delivery-mode-portaria')));

      expect(
          tester.getSemantics(find.byKey(const Key('delivery-mode-portaria'))),
          isSemantics(isSelected: true));

      final payload = await criar(tester);
      expect(payload['modo_entrega'], 'PORTARIA');
    });

    testWidgets('padrão: unidade e sem previsão', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Sem previsão')).selected,
          isTrue);
      final payload = await criar(tester);
      expect(payload['modo_entrega'], 'UNIDADE');
      expect(payload.containsKey('previsao_em'), isFalse);
    });

    testWidgets('"Em 30 min" envia a previsão de agora + 30 min', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      await tocar(tester, find.widgetWithText(ChoiceChip, 'Em 30 min'));
      final antes = DateTime.now();
      final payload = await criar(tester);

      final previsao = DateTime.parse(payload['previsao_em'] as String);
      final esperado = antes.add(const Duration(minutes: 30));
      expect(previsao.difference(esperado).inMinutes.abs(), lessThanOrEqualTo(1));
    });

    testWidgets('"Escolher horário" usa os seletores e "Sem previsão" limpa',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      await tocar(tester, find.widgetWithText(ChoiceChip, 'Escolher horário'));
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Previsão:'), findsOneWidget);
      var payload = await criar(tester);
      expect(payload.containsKey('previsao_em'), isTrue);
      // Fecha o diálogo de erro da criação (a API simulada responde 500).
      Navigator.of(tester.element(find.text('Erro'))).pop();
      await tester.pumpAndSettle();

      await tocar(tester, find.widgetWithText(ChoiceChip, 'Sem previsão'));
      payload = await criar(tester);
      expect(payload.containsKey('previsao_em'), isFalse);
    });

    testWidgets('cancelar o seletor mantém a escolha anterior', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
      await tester.pumpAndSettle();

      await tocar(tester, find.widgetWithText(ChoiceChip, 'Escolher horário'));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(tester.widget<ChoiceChip>(find.widgetWithText(ChoiceChip, 'Sem previsão')).selected,
          isTrue);
    });

    testWidgets('pré-preenche o estabelecimento quando aberto para nova entrega',
        (tester) async {
      await tester.pumpWidget(const MaterialApp(
          home: DeliveryFormPage(prefillEstablishment: 'Pizzaria Central')));
      await tester.pumpAndSettle();

      final campo = find.widgetWithText(TextFormField, 'Estabelecimento (opcional)');
      expect(tester.widget<TextFormField>(campo).controller!.text, 'Pizzaria Central');
      final payload = await criar(tester);
      expect(payload['estabelecimento'], 'Pizzaria Central');
    });

    testWidgets('renderiza no tema escuro em tela estreita sem estouro',
        (tester) async {
      tester.view.physicalSize = const Size(320 * 3, 640 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(MaterialApp(
          theme: ThemeData.dark(), home: const DeliveryFormPage()));
      await tester.pumpAndSettle();
      await tocar(tester, find.text('Mais detalhes (opcional)'));

      expect(tester.takeException(), isNull);
      expect(find.text('Criar aviso'), findsOneWidget);
    });
  });

  group('forecastForPreset', () {
    final tarde = DateTime(2026, 10, 4, 15, 12, 40);
    final noite = DateTime(2026, 10, 4, 20, 5);

    test('sem previsão é null', () {
      expect(forecastForPreset(DeliveryForecastPreset.sem, tarde), isNull);
    });

    test('agora e em 30 min (sem segundos)', () {
      expect(forecastForPreset(DeliveryForecastPreset.agora, tarde),
          DateTime(2026, 10, 4, 15, 12));
      expect(forecastForPreset(DeliveryForecastPreset.em30, tarde),
          DateTime(2026, 10, 4, 15, 42));
    });

    test('hoje à noite: 19:00, ou +2 h se já passou', () {
      expect(forecastForPreset(DeliveryForecastPreset.noite, tarde),
          DateTime(2026, 10, 4, 19));
      expect(forecastForPreset(DeliveryForecastPreset.noite, noite),
          DateTime(2026, 10, 4, 22, 5));
    });

    test('escolher usa o horário escolhido', () {
      final escolhido = DateTime(2026, 10, 6, 11, 30);
      expect(
          forecastForPreset(DeliveryForecastPreset.escolher, tarde,
              custom: escolhido),
          escolhido);
    });
  });

  testWidgets('a barra "Criar aviso" sobe acima do teclado e o campo focado fica visível',
      (tester) async {
    ApiClient.client = MockClient((request) async => http.Response(
        jsonEncode([
          {'id': 77, 'bloco': 'A', 'apto': '101'},
        ]),
        200));
    tester.view.physicalSize = const Size(400 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const MaterialApp(home: DeliveryFormPage()));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Mais detalhes (opcional)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mais detalhes (opcional)'));
    await tester.pumpAndSettle();

    final observacao =
        find.widgetWithText(TextFormField, 'Observação (opcional)');
    await tester.ensureVisible(observacao);
    await tester.pumpAndSettle();
    await tester.tap(observacao);
    await tester.pump();

    const teclado = 320.0;
    tester.view.viewInsets = const FakeViewPadding(bottom: teclado * 3);
    await tester.pumpAndSettle();

    const topoDoTeclado = 800.0 - teclado;
    final botao = tester.getRect(find.text('Criar aviso'));
    expect(botao.bottom, lessThanOrEqualTo(topoDoTeclado));
    // O campo focado rolou para a área visível acima da barra (o Flutter
    // garante o cursor, que fica na primeira linha do campo multilinha).
    final campo = tester.getRect(observacao);
    expect(campo.top, greaterThanOrEqualTo(0));
    expect(campo.top + 48, lessThanOrEqualTo(botao.top));
    expect(tester.takeException(), isNull);
  });
}
