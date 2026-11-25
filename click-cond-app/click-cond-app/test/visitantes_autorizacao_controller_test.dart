import 'dart:convert';

import 'package:click/controllers/controller_delivery.dart';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/services/card_ao_vivo/card_android.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    storageMorador({'token': 'sessao', 'user': {'id': 1, 'nome': 'Ana'}});
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  /// A3: o poll de 10 s gravava `[]` quando a busca falhava, e os cards de
  /// Autorizar/Negar sumiam da tela com o visitante esperando no portão.
  group('pendentes: falha não vira lista vazia', () {
    test('sucesso devolve a lista', () async {
      ApiClient.client = MockClient((_) async => http.Response(jsonEncode([{'id': 1}]), 200));
      expect(await apiGetPendentesOuNull(), [{'id': 1}]);
    });

    test('5xx, 401 e sem rede devolvem null (a tela mantém o que tem)', () async {
      ApiClient.client = MockClient((_) async => http.Response('erro', 500));
      expect(await apiGetPendentesOuNull(), isNull);
      ApiClient.client = MockClient((_) async => throw Exception('sem rede'));
      expect(await apiGetPendentesOuNull(), isNull);
    });

    test('apiGetPendentes continua devolvendo [] para os contadores antigos', () async {
      ApiClient.client = MockClient((_) async => http.Response('erro', 500));
      expect(await apiGetPendentes(), []);
    });
  });

  /// F8: a API devolve 30 visitas por vez (`take: 30, skip: offset`) e o app
  /// mandava sempre offset=0.
  test('lista de visitantes manda o offset pedido', () async {
    late Uri pedida;
    ApiClient.client = MockClient((req) async {
      pedida = req.url;
      return http.Response('[]', 200);
    });
    await apiGetAllVisitantes('', offset: 30);
    expect(pedida.queryParameters['offset'], '30');
    await apiGetAllVisitantes('');
    expect(pedida.queryParameters['offset'], '0');
  });

  /// A2: recarga depois de check-in/baixa (ou puxar para atualizar) com a
  /// rede oscilando esvaziava a lista: o controller devolvia [] na falha.
  test('lista de visitantes: falha devolve null na variante OuNull', () async {
    ApiClient.client = MockClient((_) async => http.Response(jsonEncode([{'id': 1}]), 200));
    expect(await apiGetAllVisitantesOuNull(''), [{'id': 1}]);
    ApiClient.client = MockClient((_) async => http.Response('erro', 503));
    expect(await apiGetAllVisitantesOuNull(''), isNull);
    ApiClient.client = MockClient((_) async => throw Exception('sem rede'));
    expect(await apiGetAllVisitantesOuNull(''), isNull);
    expect(await apiGetAllVisitantes(''), []);
  });

  test('visitantesPorPagina é o take da API', () {
    expect(visitantesPorPagina, 30);
  });

  /// F21: o ValidationPipe manda `message` como lista e a tela mostrava "[a, b]".
  test('recusa da autorização usa a mensagem curta da API', () async {
    ApiClient.client = MockClient((_) async => http.Response(
        jsonEncode({'message': ['campo a inválido', 'campo b inválido']}), 400));
    final r = await apiResponderAutorizacaoComStatus(5, true);
    expect(r.statusCode, 400);
    expect(r.erro, 'campo a inválido\ncampo b inválido');

    ApiClient.client = MockClient((_) async => http.Response(jsonEncode({'message': 'Bad Request'}), 400));
    expect((await apiResponderAutorizacaoComStatus(5, true)).erro, 'Erro ao responder solicitação');

    ApiClient.client = MockClient((_) async => http.Response('<html>proxy</html>', 502));
    expect((await apiResponderAutorizacaoComStatus(5, true)).erro, 'Erro ao responder solicitação');
  });

  /// F17: NEGAR/RECUSAR/VOU BUSCAR do card rodam em segundo plano. Um 401
  /// (senha trocada em outro aparelho) deslogava o app em silêncio e apagava
  /// o push do aparelho.
  group('card em segundo plano: 401 não desloga', () {
    test('NEGAR da portaria com 401 mantém a sessão e avisa sessão vencida', () async {
      ApiClient.client = MockClient((_) async => http.Response(jsonEncode({'message': 'Unauthorized'}), 401));
      final r = await negarPortariaDoCard(77);
      expect(r.aceito, isFalse);
      expect(r.fecharCard, isFalse);
      expect(r.sessaoVencida, isTrue);
      expect(getToken(), 'sessao');
    });

    test('RECUSAR e VOU BUSCAR do delivery com 401 mantêm a sessão', () async {
      ApiClient.client = MockClient((_) async => http.Response(jsonEncode({'message': 'Unauthorized'}), 401));
      final recusa = await respostaDeliveryDoCard(CardAndroid.acaoNegar, 55);
      expect(recusa.statusCode, 401);
      final busca = await respostaDeliveryDoCard(CardAndroid.acaoVouBuscar, 55);
      expect(busca.statusCode, 401);
      expect(getToken(), 'sessao');
    });

    test('no app aberto o 401 da tela continua encerrando a sessão', () async {
      ApiClient.client = MockClient((_) async => http.Response(jsonEncode({'message': 'Unauthorized'}), 401));
      await apiResponderDeliveryPorId(55, autorizar: true);
      expect(getToken(), isEmpty);
    });
  });
}
