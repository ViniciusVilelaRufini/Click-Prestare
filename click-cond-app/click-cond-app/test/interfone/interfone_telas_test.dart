import 'dart:convert';

import 'package:click/pages/settings/notification_settings.dart';
import 'package:click/pages/shared/interfone/historico_interfone.dart';
import 'package:click/pages/shared/my_condominium.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _json = {'content-type': 'application/json; charset=utf-8'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late bool ativo;
  late List<String> rotas;

  setUp(() async {
    await ensureStorageReady();
    ativo = true;
    rotas = [];
    ApiClient.client = MockClient((r) async {
      final path = r.url.path;
      rotas.add('${r.method} $path');
      if (path.endsWith('/interfone/disponivel')) {
        return http.Response(jsonEncode({'ativo': ativo}), 200, headers: _json);
      }
      if (path.endsWith('/interfone/preferencia')) {
        return http.Response(jsonEncode({'receber': r.method == 'GET' ? true : jsonDecode(r.body)['receber']}), 200,
            headers: _json);
      }
      if (path.endsWith('/interfone/historico')) {
        return http.Response(
            jsonEncode([
              {
                'id': 9,
                'tipo': 'facial_unidade',
                'inicio': '2026-11-27T13:05:00.000Z',
                'resultado': 'atendida_morador',
                'atendida_por_nome': 'Ana',
                'foto_url': null,
                'porta_aberta': true,
              },
            ]),
            200,
            headers: _json);
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

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  void tela(WidgetTester tester, {double altura = 2400}) {
    tester.view.physicalSize = Size(1200, altura * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  group('Notificações: "Receber chamadas do portão"', () {
    testWidgets('aparece com o módulo ligado e grava', (tester) async {
      tela(tester);
      await tester.pumpWidget(const MaterialApp(home: NotificationSettingsPage()));
      await tester.pumpAndSettle();
      expect(find.text('Receber chamadas do portão'), findsOneWidget);
      expect(find.byType(Switch), findsNWidgets(5));
      await tester.tap(find.byType(Switch).last);
      await tester.pumpAndSettle();
      expect(rotas, contains('PUT /api/interfone/preferencia'));
    });

    testWidgets('some com o módulo desligado', (tester) async {
      ativo = false;
      tela(tester);
      await tester.pumpWidget(const MaterialApp(home: NotificationSettingsPage()));
      await tester.pumpAndSettle();
      expect(find.text('Receber chamadas do portão'), findsNothing);
      expect(find.byType(Switch), findsNWidgets(4));
    });
  });

  group('Home do morador', () {
    Future<void> abrir(WidgetTester tester) async {
      storageMorador({'token': 't', 'user': {'id': 4, 'name': 'Mora'}});
      Singleton.instance.id_apartamento = 7;
      Singleton.instance.bloco = 'A';
      Singleton.instance.apartamento = '106';
      tela(tester, altura: 3000);
      await tester.pumpWidget(const MaterialApp(home: MyCondominium(id: 22)));
      await tester.pumpAndSettle();
    }

    testWidgets('módulo ligado: "Ligar para a portaria" e item "Interfone"', (tester) async {
      await abrir(tester);
      expect(find.text('LIGAR PARA A PORTARIA'), findsOneWidget);
      final item = find.text('Interfone');
      await tester.scrollUntilVisible(item, 200, scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      expect(item, findsOneWidget);
    });

    testWidgets('módulo desligado: nada do interfone', (tester) async {
      ativo = false;
      await abrir(tester);
      expect(find.text('LIGAR PARA A PORTARIA'), findsNothing);
      expect(find.text('Interfone'), findsNothing);
    });
  });

  testWidgets('histórico mostra tipo, quem atendeu e portão aberto', (tester) async {
    tela(tester);
    await tester.pumpWidget(const MaterialApp(home: HistoricoInterfonePage(idApartamento: 7)));
    await tester.pumpAndSettle();
    expect(rotas, contains('GET /api/interfone/historico'));
    expect(find.text('LIGAR PARA A PORTARIA'), findsOneWidget);
    expect(find.text('Interfone do portão'), findsOneWidget);
    expect(find.text('Atendida por Ana'), findsOneWidget);
    expect(find.text('PORTÃO ABERTO'), findsOneWidget);
  });

  test('rótulos do histórico', () {
    expect(rotuloTipoChamada('unidade_portaria'), 'Ligação para a portaria');
    expect(rotuloResultadoChamada('nao_atendida', null), 'Não atendida');
    expect(rotuloResultadoChamada('cancelada', null), 'Desligou antes de atender');
    expect(rotuloResultadoChamada('atendida_portaria', null), 'Atendida pela portaria');
  });
}
