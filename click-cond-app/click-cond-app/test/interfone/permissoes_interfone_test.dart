import 'dart:convert';

import 'package:click/pages/settings/notification_settings.dart';
import 'package:click/pages/shared/my_condominium.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/services/interfone/permissoes_interfone.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:permission_handler/permission_handler.dart';

const _json = {'content-type': 'application/json; charset=utf-8'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late PermissionStatus mic;
  late bool podeTelaCheia;
  late bool android;
  late bool telaCheiaPedida;
  late List<String> pedidos;

  setUp(() async {
    await ensureStorageReady();
    mic = PermissionStatus.denied;
    podeTelaCheia = true;
    android = false;
    telaCheiaPedida = false;
    pedidos = [];
    PermissoesInterfone.redefinirParaTeste(
      statusMicrofone: () async => mic,
      pedirMicrofone: () async {
        pedidos.add('microfone');
        return true;
      },
      podeTelaCheia: () async => podeTelaCheia,
      pedirTelaCheia: () async => pedidos.add('tela_cheia'),
      ehAndroid: () => android,
      telaCheiaJaPedida: () => telaCheiaPedida,
      marcarTelaCheiaPedida: () => telaCheiaPedida = true,
    );
  });

  tearDown(() async {
    PermissoesInterfone.redefinirParaTeste();
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<BuildContext> montar(WidgetTester tester) async {
    late BuildContext ctx;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    }))));
    return ctx;
  }

  Future<void> preparar(WidgetTester tester, BuildContext ctx, {bool doSwitch = false, String botao = 'CONTINUAR'}) async {
    final f = PermissoesInterfone.preparar(ctx, doSwitch: doSwitch);
    await tester.pumpAndSettle();
    if (find.text(botao).evaluate().isNotEmpty) {
      await tester.tap(find.text(botao));
      await tester.pumpAndSettle();
    }
    await f;
  }

  testWidgets('microfone ainda não pedido: explica e pede', (tester) async {
    final ctx = await montar(tester);
    final f = PermissoesInterfone.preparar(ctx);
    await tester.pumpAndSettle();
    expect(find.textContaining('precisa usar o microfone'), findsOneWidget);
    await tester.tap(find.text('CONTINUAR'));
    await tester.pumpAndSettle();
    await f;
    expect(pedidos, ['microfone']);
  });

  testWidgets('pergunta uma vez por sessão (o switch pergunta de novo)', (tester) async {
    final ctx = await montar(tester);
    await preparar(tester, ctx, botao: 'AGORA NÃO');
    expect(pedidos, isEmpty);
    await preparar(tester, ctx);
    expect(pedidos, isEmpty, reason: 'segunda vez na mesma sessão não pergunta');
    await preparar(tester, ctx, doSwitch: true);
    expect(pedidos, ['microfone']);
  });

  testWidgets('microfone concedido e tela cheia ok: nada a pedir', (tester) async {
    mic = PermissionStatus.granted;
    android = true;
    final ctx = await montar(tester);
    await preparar(tester, ctx);
    expect(find.byType(Dialog), findsNothing);
    expect(pedidos, isEmpty);
  });

  testWidgets('Android 14 sem tela cheia: pede uma vez, junto do microfone', (tester) async {
    android = true;
    podeTelaCheia = false;
    final ctx = await montar(tester);
    final f = PermissoesInterfone.preparar(ctx);
    await tester.pumpAndSettle();
    expect(find.textContaining('tela cheia'), findsOneWidget);
    await tester.tap(find.text('CONTINUAR'));
    await tester.pumpAndSettle();
    await f;
    expect(pedidos, ['microfone', 'tela_cheia']);
    expect(telaCheiaPedida, isTrue);

    // Próxima sessão: o microfone já foi dado; a tela cheia não pergunta de novo.
    mic = PermissionStatus.granted;
    pedidos.clear();
    PermissoesInterfone.esquecerSessao();
    await preparar(tester, ctx);
    expect(pedidos, isEmpty);
  });

  testWidgets('microfone bloqueado no sistema: o switch manda liberar nas configurações', (tester) async {
    mic = PermissionStatus.permanentlyDenied;
    final ctx = await montar(tester);
    await preparar(tester, ctx, doSwitch: true);
    expect(pedidos, isEmpty);
    expect(find.textContaining('Libere o microfone'), findsOneWidget);
  });

  group('onde pede', () {
    setUp(() {
      ApiClient.client = MockClient((r) async {
        final path = r.url.path;
        if (path.endsWith('/interfone/disponivel')) return http.Response(jsonEncode({'ativo': true}), 200, headers: _json);
        if (path.endsWith('/interfone/preferencia')) {
          return http.Response(jsonEncode({'receber': r.method == 'GET' ? false : true}), 200, headers: _json);
        }
        if (path.endsWith('/users/settings')) {
          return http.Response(
              jsonEncode({'notif_encomendas': 1, 'notif_comunicados': 1, 'notif_ocorrencias': 1, 'notif_visitantes': 1}),
              200,
              headers: _json);
        }
        if (path.endsWith('/condominio/get-condominio')) {
          return http.Response(jsonEncode({'id': 22, 'nome': 'Residencial Teste', 'saldo': '0'}), 200, headers: _json);
        }
        if (path.endsWith('/dashboard/summary')) return http.Response('{}', 200, headers: _json);
        return http.Response('[]', 200, headers: _json);
      });
    });

    testWidgets('home: quando o módulo aparece ligado', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 4, 'name': 'Mora'}});
      Singleton.instance.id_apartamento = 7;
      tester.view.physicalSize = const Size(1200, 9000);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: MyCondominium(id: 22)));
      await tester.pumpAndSettle();
      expect(find.textContaining('precisa usar o microfone'), findsOneWidget);
      await tester.tap(find.text('CONTINUAR'));
      await tester.pumpAndSettle();
      expect(pedidos, ['microfone']);
    });

    testWidgets('Notificações: ao ligar "Receber chamadas do portão"', (tester) async {
      tester.view.physicalSize = const Size(1200, 7200);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: NotificationSettingsPage()));
      await tester.pumpAndSettle();
      expect(find.byType(Dialog), findsNothing);
      await tester.tap(find.byType(Switch).last);
      await tester.pumpAndSettle();
      expect(find.textContaining('precisa usar o microfone'), findsOneWidget);
      await tester.tap(find.text('CONTINUAR'));
      await tester.pumpAndSettle();
      expect(pedidos, ['microfone']);
    });
  });
}
