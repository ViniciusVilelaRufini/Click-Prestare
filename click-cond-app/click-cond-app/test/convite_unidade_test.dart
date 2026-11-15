import 'dart:convert';

import 'package:click/controllers/controller_visitantes.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// O convite ia só com `{is_prestador}` e a API escolhia a primeira unidade
/// da conta: o morador com duas unidades, navegando na segunda, gerava o link
/// para a primeira. A API aceita `id_apartamento` (conferido contra os
/// vínculos do morador); o app manda a unidade aberta.
void main() {
  group('corpoGerarConvite', () {
    test('com unidade aberta, manda a unidade', () {
      expect(corpoGerarConvite(isPrestador: false, idApartamento: 55),
          {'is_prestador': false, 'id_apartamento': 55});
      expect(corpoGerarConvite(isPrestador: true, idApartamento: '56'),
          {'is_prestador': true, 'id_apartamento': 56});
    });

    test('sem unidade (síndico sem apto, -1, vazio), não manda — a API escolhe como antes', () {
      for (final semUnidade in [null, -1, 0, '', 'abc']) {
        expect(corpoGerarConvite(isPrestador: false, idApartamento: semUnidade), {'is_prestador': false},
            reason: 'idApartamento=$semUnidade');
      }
    });
  });

  group('apiGerarConvite', () {
    setUp(() async {
      await ensureStorageReady();
      storageMorador({
        'token': 'token-morador',
        'user': {'id': 1, 'nome': 'Ana'},
      });
      Singleton.instance.id_condominio = 22;
    });

    tearDown(() async {
      ApiClient.restaurarPadroes();
      await storageLogout();
      Singleton.instance.reset();
    });

    Future<Map<String, dynamic>> corpoEnviado({required bool isPrestador}) async {
      late Map<String, dynamic> corpo;
      ApiClient.client = MockClient((req) async {
        corpo = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response('{"url":"https://x.test/c/abc"}', 200);
      });
      await apiGerarConvite(isPrestador: isPrestador);
      return corpo;
    }

    test('envia a unidade em que o morador está navegando', () async {
      Singleton.instance.id_apartamento = 77;
      expect(await corpoEnviado(isPrestador: true), {'is_prestador': true, 'id_apartamento': 77});
    });

    test('sem unidade selecionada, manda só o tipo', () async {
      Singleton.instance.id_apartamento = -1;
      expect(await corpoEnviado(isPrestador: false), {'is_prestador': false});
    });
  });
}
