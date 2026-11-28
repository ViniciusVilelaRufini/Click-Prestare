import 'dart:convert';

import 'package:click/pages/shared/interfone/pedido_portao.dart';
import 'package:click/services/firebase_service.dart';
import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> _pedido(String estado, {String? mensagem, String? por}) => {
      'id': 7,
      'estado': estado,
      'nome_falado': 'Carlos',
      'motivo': 'Entrega de móvel',
      'tipo': 'entrega',
      'mensagem': mensagem,
      'respondido_por_nome': por,
      'respondido_em': null,
      'portao_aberto': estado == 'autorizado',
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<String> chamadas;
  late List<Map<String, dynamic>> corpos;
  late String estadoGet;
  late int statusPost;

  setUp(() {
    chamadas = [];
    corpos = [];
    estadoGet = 'pendente';
    statusPost = 201;
    ApiClient.tokenProvider = () => 'sessao';
    ApiClient.client = MockClient((r) async {
      chamadas.add('${r.method} ${r.url.path}');
      if (r.method == 'POST') {
        corpos.add(jsonDecode(r.body) as Map<String, dynamic>);
        if (statusPost == 409) return http.Response(jsonEncode({'motivo': 'pedido_respondido'}), 409);
        final autorizar = corpos.last['decisao'] == 'autorizar';
        return http.Response(
            jsonEncode(_pedido(autorizar ? 'autorizado' : 'negado', mensagem: corpos.last['mensagem'] as String?)), 201);
      }
      return http.Response(jsonEncode(_pedido(estadoGet, por: estadoGet == 'pendente' ? null : 'Ana')), 200);
    });
  });

  tearDown(ApiClient.restaurarPadroes);

  const push = {
    'type': 'interfone_pedido',
    'id': '7',
    'unidade': 'Apto 106',
    'condominio': 'Boa Vista',
    'portao': 'Portão social',
    'nome': 'Carlos',
    'motivo': 'Entrega de móvel',
    'tipo': 'entrega',
  };

  Future<void> abrir(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
            builder: (_) => PedidoPortaoPage(
              id: 7,
              inicial: PedidoPortao.doPush(push),
              esperaAoFechar: const Duration(seconds: 3),
            ),
          )),
          child: const Text('abrir'),
        ),
      ),
    ));
    await tester.tap(find.text('abrir'));
    await tester.pumpAndSettle();
  }

  testWidgets('mostra nome e motivo e chama responder com autorizar', (tester) async {
    await abrir(tester);
    expect(find.text('NA PORTARIA: CARLOS'), findsOneWidget);
    expect(find.text('Entrega de móvel'), findsOneWidget);
    expect(find.text('Abre o portão uma vez'), findsOneWidget);

    await tester.tap(find.text('AUTORIZAR'));
    await tester.pumpAndSettle();

    expect(chamadas, contains('POST /api/interfone/pedidos/7/responder'));
    expect(corpos.single, {'decisao': 'autorizar'});
    expect(find.text('PORTÃO ABERTO'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  });

  testWidgets('chip "Já desço" selecionado vai como mensagem junto da decisão tocada depois', (tester) async {
    await abrir(tester);
    await tester.tap(find.text('JÁ DESÇO'));
    await tester.pump();
    await tester.ensureVisible(find.text('NEGAR'));
    await tester.pump();
    await tester.tap(find.text('NEGAR'));
    await tester.pumpAndSettle();

    expect(corpos.single, {'decisao': 'negar', 'mensagem': 'Já desço'});
    expect(find.text('NEGADO'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  });

  testWidgets('estado expirado desabilita os botões', (tester) async {
    estadoGet = 'expirado';
    await abrir(tester);
    expect(find.text('EXPIRADO'), findsOneWidget);
    await tester.tap(find.text('AUTORIZAR'), warnIfMissed: false);
    await tester.tap(find.text('NEGAR'), warnIfMissed: false);
    await tester.pump();
    expect(chamadas.where((c) => c.startsWith('POST')), isEmpty);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  });

  testWidgets('409 mostra quem respondeu', (tester) async {
    await abrir(tester);
    statusPost = 409;
    estadoGet = 'autorizado';
    await tester.tap(find.text('AUTORIZAR'));
    await tester.pumpAndSettle();
    expect(find.text('RESPONDIDO POR ANA · PORTÃO ABERTO'), findsOneWidget);
    await tester.pump(const Duration(seconds: 4));
    await tester.pumpAndSettle();
  });

  testWidgets('interfone_pedido_fim fecha a tela', (tester) async {
    await abrir(tester);
    expect(find.byType(PedidoPortaoPage), findsOneWidget);
    await tratarPushDoInterfone({'type': 'interfone_pedido_fim', 'id': '7'});
    await tester.pumpAndSettle();
    expect(find.byType(PedidoPortaoPage), findsNothing);
  });
}
