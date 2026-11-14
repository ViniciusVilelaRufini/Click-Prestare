import 'dart:convert';

import 'package:click/services/card_ao_vivo/card_android.dart';
import 'package:click/services/card_ao_vivo/link_card.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('RECUSAR recusado pelo servidor: só 400/409 fecham o card; sem rede ou 401 ele fica', () {
    expect(respostaRecusadaFechaCard(400), isTrue);
    expect(respostaRecusadaFechaCard(409), isTrue);
    expect(respostaRecusadaFechaCard(null), isFalse); // sem rede / timeout
    expect(respostaRecusadaFechaCard(401), isFalse);
    expect(respostaRecusadaFechaCard(500), isFalse);
  });

  group('botões de segundo plano do delivery', () {
    tearDown(ApiClient.restaurarPadroes);

    test('NEGAR (RECUSAR) e VOU BUSCAR rodam em segundo plano; AUTORIZAR abre o app', () {
      expect(CardAndroid.acaoVouBuscar, 'vou_buscar');
      expect(acaoDeSegundoPlano(CardAndroid.acaoNegar), isTrue);
      expect(acaoDeSegundoPlano(CardAndroid.acaoVouBuscar), isTrue);
      expect(acaoDeSegundoPlano(CardAndroid.acaoAutorizar), isFalse);
      expect(acaoDeSegundoPlano(null), isFalse);
    });

    test('vou_buscar chama a API de "vou buscar" com o id do pedido', () async {
      late http.Request request;
      ApiClient.tokenProvider = () => 'sessao';
      ApiClient.client = MockClient((captured) async {
        request = captured;
        return http.Response(jsonEncode({'id': 55, 'status': 'RETIRADA_NA_PORTARIA'}), 200);
      });

      final r = await respostaDeliveryDoCard(CardAndroid.acaoVouBuscar, 55);

      expect(r.success, isTrue);
      expect(request.method, 'PATCH');
      expect(request.url.path, '/api/delivery/55');
      expect(jsonDecode(request.body), {'status': 'RETIRADA_NA_PORTARIA'});
    });

    test('negar no delivery continua recusando com motivo', () async {
      late http.Request request;
      ApiClient.tokenProvider = () => 'sessao';
      ApiClient.client = MockClient((captured) async {
        request = captured;
        return http.Response(jsonEncode({'id': 55, 'status': 'RECUSADA'}), 200);
      });

      await respostaDeliveryDoCard(CardAndroid.acaoNegar, 55);

      expect(request.url.path, '/api/delivery/55');
      expect(jsonDecode(request.body), {'status': 'RECUSADA', 'motivo': 'Recusada pelo morador.'});
    });

    test('fase mostrada na hora depois do botão', () {
      expect(faseDepoisDoBotao(CardAndroid.acaoVouBuscar), 'retirar');
      expect(faseDepoisDoBotao(CardAndroid.acaoNegar), 'recusado');
    });
  });

  test('toque no card do iPhone abre a tela certa', () {
    expect(telaDoLinkCard(Uri.parse('clickprestare://solicitacoes')), 'autorizacao_visitante');
    expect(telaDoLinkCard(Uri.parse('clickprestare://delivery')), 'delivery');
    expect(telaDoLinkCard(Uri.parse('clickprestare://redefinir-senha?token=x')), isNull);
    expect(telaDoLinkCard(Uri.parse('https://delivery')), isNull);
  });
}
