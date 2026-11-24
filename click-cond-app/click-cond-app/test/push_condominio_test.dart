import 'dart:convert';

import 'package:click/controllers/controller_financeiro.dart';
import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/services/push_condominio.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// C4/A3: os pushes 'financeiro' e 'autorizacao_visitante' levam o condomínio.
/// - autorização: o toque lista os pendentes do condomínio do push, não os do
///   condomínio aberto (quem tem vínculo em dois via a lista vazia);
/// - financeiro com o app fechado: sem condomínio aberto a API dava 403.
void main() {
  setUp(() async {
    await ensureStorageReady();
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  test('condominioDoPush lê o id (string do FCM) e ignora ausente/inválido', () {
    expect(condominioDoPush({'id_condominio': '42'}), 42);
    expect(condominioDoPush({}), isNull);
    expect(condominioDoPush({'id_condominio': ''}), isNull);
    expect(condominioDoPush({'id_condominio': '0'}), isNull);
  });

  test('financeiro: as requisições saem com o condomínio do push e o Singleton não muda', () async {
    final pedidas = <Uri>[];
    ApiClient.client = MockClient((req) async {
      pedidas.add(req.url);
      return http.Response(jsonEncode({}), 200);
    });
    for (final aberto in [null, 7]) {
      pedidas.clear();
      Singleton.instance.id_condominio = aberto;
      await apiGetFinanceiroByUser(idCondominio: 42);
      await apiGetAllFinanceiro('financeiro', '11', '2026', idCondominio: 42);
      expect(pedidas.map((u) => u.queryParameters['id_condominio']), ['42', '42'], reason: 'aberto=$aberto');
      expect(Singleton.instance.id_condominio, aberto);
    }
  });

  test('financeiro sem push: o condomínio aberto', () async {
    late Uri pedida;
    ApiClient.client = MockClient((req) async {
      pedida = req.url;
      return http.Response(jsonEncode({}), 200);
    });
    Singleton.instance.id_condominio = 7;
    await apiGetFinanceiroByUser();
    expect(pedida.queryParameters['id_condominio'], '7');
  });

  group('pendentes de autorização', () {
    late Uri pedida;
    setUp(() {
      ApiClient.client = MockClient((req) async {
        pedida = req.url;
        return http.Response(jsonEncode([]), 200);
      });
    });

    test('o condomínio do push vence o condomínio aberto', () async {
      Singleton.instance.id_condominio = 7;
      await apiGetPendentes(idCondominio: 42);
      expect(pedida.queryParameters['id_condominio'], '42');
    });

    test('sem push, o condomínio aberto; sem nenhum, não manda "null"', () async {
      Singleton.instance.id_condominio = 7;
      await apiGetPendentes();
      expect(pedida.queryParameters['id_condominio'], '7');
      Singleton.instance.id_condominio = null;
      await apiGetPendentes();
      expect(pedida.queryParameters.containsKey('id_condominio'), isFalse);
    });
  });
}
