import 'dart:convert';
import 'dart:typed_data';

import 'package:click/controllers/controller_wallet.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Rotas do passe na carteira: situação (GET), o .pkpass binário (POST) e o
/// cancelamento (POST). Erro vem como `{erro: <message do servidor>}`.
void main() {
  late List<http.Request> pedidos;
  late http.Response Function(http.Request) responder;

  setUp(() {
    pedidos = [];
    ApiClient.tokenProvider = () => 'token';
    ApiClient.client = MockClient((req) async {
      pedidos.add(req);
      return responder(req);
    });
  });

  tearDown(ApiClient.restaurarPadroes);

  test('situação: GET com id_condominio na query', () async {
    responder = (_) => http.Response(
          jsonEncode({
            'habilitado': true,
            'apple': {'disponivel': true, 'ativo': false},
            'google': {'disponivel': false, 'ativo': false},
          }),
          200,
        );
    final r = await apiWalletSituacao(10);
    expect(pedidos.single.method, 'GET');
    expect(pedidos.single.url.path, '/api/credenciais/wallet/situacao');
    expect(pedidos.single.url.queryParameters['id_condominio'], '10');
    expect(r['habilitado'], true);
    expect((r['apple'] as Map)['disponivel'], true);
  });

  test('passe da Apple: POST com o condomínio e os bytes do arquivo', () async {
    final arquivo = Uint8List.fromList([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    responder = (_) => http.Response.bytes(arquivo, 200, headers: {'content-type': 'application/vnd.apple.pkpass'});
    final r = await apiWalletPasseApple(10);
    expect(pedidos.single.method, 'POST');
    expect(pedidos.single.url.path, '/api/credenciais/wallet/apple');
    expect(jsonDecode(pedidos.single.body), {'id_condominio': 10});
    expect(r['bytes'], arquivo);
  });

  test('passe da Apple com erro: a mensagem do servidor', () async {
    responder = (_) => http.Response(jsonEncode({'message': 'Carteira indisponível no momento.'}), 503);
    final r = await apiWalletPasseApple(10);
    expect(r.containsKey('bytes'), false);
    expect(r['erro'], 'Carteira indisponível no momento.');
  });

  test('cancelar: POST com o condomínio', () async {
    responder = (_) => http.Response(jsonEncode({'ok': true}), 200);
    final r = await apiWalletCancelar(10);
    expect(pedidos.single.url.path, '/api/credenciais/wallet/cancelar');
    expect(jsonDecode(pedidos.single.body), {'id_condominio': 10});
    expect(r['ok'], true);
  });

  test('cancelar com erro sem message: texto padrão', () async {
    responder = (_) => http.Response('', 500);
    final r = await apiWalletCancelar(10);
    expect(r['erro'], 'Não foi possível cancelar o passe.');
  });
}
