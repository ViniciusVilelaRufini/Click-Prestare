import 'dart:convert';

import 'package:click/controllers/controller_vagas.dart';
import 'package:click/controllers/controller_veiculos.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Vagas e veículos iam só com `id_condominio` e a API escolhia a primeira
/// unidade da conta: o dono do 101 e do 202 abria o 202 e operava o 101. O
/// app manda a unidade aberta (`id_apartamento`); a API confere a posse.
void main() {
  late List<http.Request> pedidos;

  setUp(() async {
    await ensureStorageReady();
    storageMorador({
      'token': 'token-morador',
      'user': {'id': 1, 'nome': 'Ana'},
    });
    Singleton.instance.id_condominio = 22;
    pedidos = [];
    ApiClient.client = MockClient((req) async {
      pedidos.add(req);
      return http.Response('{}', 200);
    });
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  test('com unidade aberta, toda rota de vagas e veículos manda a unidade', () async {
    Singleton.instance.id_apartamento = 77;
    await apiGetVagas();
    await apiGetBeneficiarios();
    await apiLiberarVaga(tipo: 'visitante', idVisitante: 3);
    await apiRevogarVaga(9);
    await apiGetAllVeiculos();
    await apiSalvarVeiculo({'placa': 'ABC1D23'}, false);
    await apiRemoverVeiculo(5);

    expect(pedidos, hasLength(7));
    for (final r in pedidos) {
      final valor = r.method == 'GET'
          ? r.url.queryParameters['id_apartamento']
          : (jsonDecode(r.body) as Map<String, dynamic>)['id_apartamento'];
      expect(valor, '77', reason: '${r.method} ${r.url.path}');
    }
  });

  test('sem unidade (síndico -1 ou nula), não manda — a API usa o vínculo mais antigo', () async {
    for (final semUnidade in [null, -1]) {
      pedidos.clear();
      Singleton.instance.id_apartamento = semUnidade;
      await apiGetVagas();
      await apiLiberarVaga(tipo: 'visitante', idVisitante: 3);
      await apiGetAllVeiculos();
      await apiRemoverVeiculo(5);
      for (final r in pedidos) {
        final temCampo = r.method == 'GET'
            ? r.url.queryParameters.containsKey('id_apartamento')
            : (jsonDecode(r.body) as Map<String, dynamic>).containsKey('id_apartamento');
        expect(temCampo, isFalse, reason: '$semUnidade ${r.method} ${r.url.path}');
      }
    }
  });
}
