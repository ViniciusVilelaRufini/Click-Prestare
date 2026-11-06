import 'dart:convert';

import 'package:click/pages/settings/qr_web_access_page.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A tela de acesso web autorizava a sessão no instante em que a câmera lia
/// qualquer "qr_...". Quem repassasse o QR da própria tela de login ("escaneia
/// aqui pra eu te ajudar") entrava no console com o acesso do síndico. Agora o
/// app pergunta antes, e só a confirmação chama o servidor.
void main() {
  late List<http.Request> chamadas;

  setUp(() {
    chamadas = [];
    ApiClient.tokenProvider = () => 'token-do-usuario';
    ApiClient.client = MockClient((req) async {
      chamadas.add(req);
      return http.Response('{"success":true}', 200);
    });
  });

  tearDown(ApiClient.restaurarPadroes);

  Future<Future<http.Response?>> abrir(WidgetTester tester) async {
    late Future<http.Response?> resultado;
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => ElevatedButton(
          onPressed: () {
            resultado = confirmarEAutorizarQrWeb(context, qrToken: 'qr_abc', idCondominio: 7);
          },
          child: const Text('ler'),
        ),
      ),
    ));
    await tester.tap(find.text('ler'));
    await tester.pumpAndSettle();
    return resultado;
  }

  testWidgets('mostra a confirmação e não chama o servidor antes dela', (tester) async {
    await abrir(tester);

    expect(find.text('LIBERAR ACESSO AO CONSOLE WEB?'), findsOneWidget);
    expect(chamadas, isEmpty);
  });

  testWidgets('Cancelar não autoriza nada', (tester) async {
    final resultado = await abrir(tester);
    await tester.tap(find.text('CANCELAR'));
    await tester.pumpAndSettle();

    expect(await resultado, isNull);
    expect(chamadas, isEmpty);
  });

  testWidgets('Autorizar chama POST /auth/qr/authorize com o QR lido', (tester) async {
    final resultado = await abrir(tester);
    await tester.tap(find.text('AUTORIZAR'));
    await tester.pumpAndSettle();

    final resposta = await resultado;
    expect(resposta!.statusCode, 200);
    expect(chamadas, hasLength(1));
    expect(chamadas.single.method, 'POST');
    expect(chamadas.single.url.path, endsWith('/auth/qr/authorize'));
    expect(jsonDecode(chamadas.single.body), {'qrToken': 'qr_abc', 'id_condominio': 7});
  });
}
