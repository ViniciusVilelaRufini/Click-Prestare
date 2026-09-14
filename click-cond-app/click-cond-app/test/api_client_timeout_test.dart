import 'dart:async';

import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// O package `http` NÃO tem timeout padrão: numa rede que aceita a conexão e
/// nunca responde (captive portal de hotel, Railway em cold start, 3G no hall
/// do prédio), o Future simplesmente não completa.
///
/// `ApiConfig.timeout` existia, mas era aplicado a mão em cada call site — e
/// controllers inteiros esqueceram: financeiro, encomendas, consentimento e o
/// login de funcionário. O sintoma é a tela girando o skeleton para sempre, sem
/// erro e sem retry; no caso do consentimento, que é bloqueante, o app inteiro
/// não abre. O lugar certo do timeout é aqui dentro, onde nenhum call site
/// pode esquecer.
void main() {
  setUp(() {
    ApiClient.client = MockClient((_) async => http.Response('{"ok":true}', 200));
    ApiClient.timeout = const Duration(milliseconds: 50);
  });

  tearDown(() {
    ApiClient.restaurarPadroes();
  });

  final url = Uri.parse('https://exemplo.test/financeiro/get-all');

  /// Servidor que aceita a conexão e nunca responde — o caso que trava a tela.
  MockClient mudo() => MockClient((_) async {
        await Future<void>.delayed(const Duration(seconds: 30));
        return http.Response('{}', 200);
      });

  test('GET desiste quando o servidor não responde', () {
    ApiClient.client = mudo();
    expect(ApiClient.get(url), throwsA(isA<TimeoutException>()));
  });

  test('POST desiste quando o servidor não responde', () {
    ApiClient.client = mudo();
    expect(ApiClient.post(url, body: '{}'), throwsA(isA<TimeoutException>()));
  });

  test('PUT desiste quando o servidor não responde', () {
    ApiClient.client = mudo();
    expect(ApiClient.put(url, body: '{}'), throwsA(isA<TimeoutException>()));
  });

  test('DELETE desiste quando o servidor não responde', () {
    ApiClient.client = mudo();
    expect(ApiClient.delete(url), throwsA(isA<TimeoutException>()));
  });

  test('resposta dentro do prazo passa normalmente', () async {
    final res = await ApiClient.get(url);
    expect(res.statusCode, 200);
    expect(res.body, '{"ok":true}');
  });

  /// O timeout não pode engolir os headers nem o corpo do request.
  test('repassa headers e body ao cliente', () async {
    late http.Request capturada;
    ApiClient.client = MockClient((req) async {
      capturada = req;
      return http.Response('{}', 200);
    });

    await ApiClient.post(
      url,
      headers: {'Authorization': 'token-abc', 'Content-Type': 'application/json'},
      body: '{"valor":10}',
    );

    expect(capturada.headers['Authorization'], 'token-abc');
    expect(capturada.body, '{"valor":10}');
  });

  test('o padrão de produção é o timeout do ApiConfig, não infinito', () {
    ApiClient.restaurarPadroes();
    expect(ApiClient.timeout.inSeconds, greaterThan(0));
    expect(ApiClient.timeout.inMinutes, lessThanOrEqualTo(2));
  });
}
