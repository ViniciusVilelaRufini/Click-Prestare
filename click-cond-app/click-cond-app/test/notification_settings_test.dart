import 'dart:convert';

import 'package:click/pages/settings/notification_settings.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Configurações de notificação: carga com erro deixava o spinner girando
/// para sempre, e salvar ignorava a resposta (o switch ficava desligado na
/// tela e ligado no servidor).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const json = {'content-type': 'application/json; charset=utf-8'};
  final tudoLigado = {
    'notif_encomendas': 1,
    'notif_comunicados': 1,
    'notif_ocorrencias': 1,
    'notif_visitantes': 1,
  };

  tearDown(ApiClient.restaurarPadroes);

  Future<void> abrir(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: NotificationSettingsPage()));
    await tester.pumpAndSettle();
  }

  testWidgets('carga com erro mostra a mensagem e "tentar de novo" em vez do spinner eterno', (tester) async {
    var falhar = true;
    ApiClient.client = MockClient((req) async {
      if (falhar) return http.Response('erro', 500);
      return http.Response(jsonEncode(tudoLigado), 200, headers: json);
    });
    await abrir(tester);

    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.text('Não foi possível carregar suas preferências de notificação.'), findsOneWidget);

    falhar = false;
    await tester.tap(find.text('TENTAR DE NOVO'));
    await tester.pumpAndSettle();
    expect(find.text('Encomendas'), findsOneWidget);
    expect(find.byType(Switch), findsNWidgets(4));
  });

  testWidgets('salvar recusado volta o switch e avisa', (tester) async {
    final enviados = <Map<String, dynamic>>[];
    ApiClient.client = MockClient((req) async {
      if (req.method == 'POST') {
        enviados.add(jsonDecode(req.body) as Map<String, dynamic>);
        return http.Response('erro', 500);
      }
      return http.Response(jsonEncode(tudoLigado), 200, headers: json);
    });
    await abrir(tester);

    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();

    expect(enviados.single['notif_encomendas'], isFalse);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue, reason: 'voltou ao que o servidor tem');
    expect(find.text('Não foi possível salvar a preferência. Tente novamente.'), findsOneWidget);
  });

  testWidgets('salvar aceito mantém o switch como a pessoa deixou', (tester) async {
    ApiClient.client = MockClient((req) async {
      if (req.method == 'POST') return http.Response('{"success":true}', 200, headers: json);
      return http.Response(jsonEncode(tudoLigado), 200, headers: json);
    });
    await abrir(tester);

    await tester.tap(find.byType(Switch).first);
    await tester.pumpAndSettle();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isFalse);
    expect(find.text('Não foi possível salvar a preferência. Tente novamente.'), findsNothing);
  });
}
