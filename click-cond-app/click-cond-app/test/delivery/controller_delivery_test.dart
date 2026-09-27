import 'dart:convert';

import 'package:click/controllers/controller_delivery.dart';
import 'package:click/models/delivery_model.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
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

  test('cria aviso para a unidade atual após a confirmação da API', () async {
    late http.Request request;
    ApiClient.client = MockClient((captured) async {
      request = captured;
      return http.Response(
          jsonEncode({
            'id': 99,
            'id_condominio': 11,
            'id_apartamento': 22,
            'status': 'AGENDADA',
            'modo_entrega': 'UNIDADE',
          }),
          201);
    });

    final result = await apiCreateDelivery(const DeliveryDraft(
      estabelecimento: 'Padaria',
      nomeEntregador: 'João da Silva',
      telefoneEntregador: '(11) 99999-9999',
      modoEntrega: DeliveryModoEntrega.unidade,
    ));

    expect(result.success, isTrue);
    expect(result.delivery?.id, 99);
    expect(request.method, 'POST');
    expect(request.url.path, '/api/delivery');
    final payload = jsonDecode(request.body) as Map<String, dynamic>;
    expect(payload['id_apartamento'], 22);
    expect(payload['nome_entregador'], 'João da Silva');
    expect(payload['telefone_entregador'], '(11) 99999-9999');
    expect(request.headers['Authorization'], 'sessao-do-morador');
  });

  test('mantém a criação sem sucesso quando a API rejeita o aviso', () async {
    ApiClient.client = MockClient((_) async {
      return http.Response(jsonEncode({'message': 'Dados inválidos'}), 422);
    });

    final result = await apiCreateDelivery(
        const DeliveryDraft(estabelecimento: 'Padaria'));

    expect(result.success, isFalse);
    expect(result.delivery, isNull);
    expect(result.message, 'Dados inválidos');
  });

  test('mantém o cancelamento sem sucesso quando a API falha', () async {
    late http.Request request;
    ApiClient.client = MockClient((captured) async {
      request = captured;
      return http.Response(
          jsonEncode({'message': 'Cancelamento indisponível'}), 500);
    });

    final result = await apiCancelDelivery(const DeliveryModel(id: 99));

    expect(result.success, isFalse);
    expect(result.delivery, isNull);
    expect(result.message, 'Cancelamento indisponível');
    expect(request.method, 'PATCH');
  });
}
