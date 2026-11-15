import 'dart:convert';

import 'package:click/controllers/controller_encomendas.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/controllers/controller_moradores.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A API passou a explicar as recusas (`message` com status 400/403/409) —
/// "Esta reserva já aconteceu.", "Unidade não encontrada neste condomínio.",
/// "Este espaço tem 1 reserva ativa…" — e o app trocava tudo por "Falha ao
/// salvar… Verifique a conexão.", que manda o síndico checar o Wi-Fi quando o
/// problema é outro. Estes testes cobrem o filtro que decide se a `message`
/// pode ir para a tela e os métodos que passam a devolvê-la.
void main() {
  group('mensagemCurtaDaApi', () {
    test('devolve a message em português da API', () {
      expect(
        mensagemCurtaDaApi('{"message":"Esta reserva já aconteceu.","error":"Conflict","statusCode":409}'),
        'Esta reserva já aconteceu.',
      );
    });

    test('aceita a recusa longa do espaço com terminal facial', () {
      const msg = 'Este espaço tem um terminal facial ligado a ele. Em Terminais faciais, ligue o terminal '
          'a outro espaço ou exclua o terminal antes de excluir este espaço (terminal desativado também '
          'conta). Sem espaço, o terminal passaria a liberar todos os moradores.';
      expect(mensagemCurtaDaApi(jsonEncode({'message': msg, 'statusCode': 409})), msg);
    });

    test('junta a lista do ValidationPipe', () {
      expect(mensagemCurtaDaApi('{"message":["Informe a unidade.","Informe a descrição."]}'),
          'Informe a unidade.\nInforme a descrição.');
    });

    test('corpo que não é JSON (HTML de proxy) não vai para a tela', () {
      expect(mensagemCurtaDaApi('<html><body>502 Bad Gateway</body></html>'), isNull);
      expect(mensagemCurtaDaApi(''), isNull);
    });

    test('sem message, ou message vazia, devolve null', () {
      expect(mensagemCurtaDaApi('{"statusCode":500}'), isNull);
      expect(mensagemCurtaDaApi('{"message":"   "}'), isNull);
      expect(mensagemCurtaDaApi('[1,2]'), isNull);
    });

    test('texto técnico não vai para a tela', () {
      expect(mensagemCurtaDaApi('{"message":"Internal server error","statusCode":500}'), isNull);
      expect(mensagemCurtaDaApi('{"message":"Bad Request"}'), isNull);
      expect(mensagemCurtaDaApi('{"message":"Forbidden resource"}'), isNull);
      expect(mensagemCurtaDaApi('{"message":"TypeError: Cannot read properties of undefined"}'), isNull);
      expect(
        mensagemCurtaDaApi(jsonEncode({'message': 'Invalid `prisma.encomendas.update()` invocation:\n  at x'})),
        isNull,
      );
      expect(mensagemCurtaDaApi(jsonEncode({'message': 'Falhou\n    at Object.<anonymous> (main.js:1:1)'})), isNull);
      expect(mensagemCurtaDaApi(jsonEncode({'message': '{"campo":"valor"}'})), isNull);
      expect(mensagemCurtaDaApi(jsonEncode({'message': '<b>erro</b>'})), isNull);
    });

    test('message gigante não vai para a tela', () {
      expect(mensagemCurtaDaApi(jsonEncode({'message': 'a' * 600})), isNull);
    });

    test('message que não é texto nem lista não vai para a tela', () {
      expect(mensagemCurtaDaApi('{"message":{"campo":"x"}}'), isNull);
      expect(mensagemCurtaDaApi('{"message":42}'), isNull);
    });
  });

  group('ResultadoApi', () {
    test('2xx é sucesso, sem mensagem', () {
      final r = ResultadoApi.daResposta(201, '{"ok":true}');
      expect(r.ok, isTrue);
      expect(r.mensagem, isNull);
    });

    test('recusa leva a message da API', () {
      final r = ResultadoApi.daResposta(409, '{"message":"Esta reserva já aconteceu."}');
      expect(r.ok, isFalse);
      expect(r.mensagemOu('Erro genérico'), 'Esta reserva já aconteceu.');
    });

    test('recusa sem message usável cai no texto genérico', () {
      final r = ResultadoApi.daResposta(502, '<html>502</html>');
      expect(r.ok, isFalse);
      expect(r.mensagemOu('Erro genérico'), 'Erro genérico');
    });

    test('sem conexão cai no texto genérico', () {
      expect(const ResultadoApi.falha().mensagemOu('Verifique a conexão.'), 'Verifique a conexão.');
    });
  });

  group('chamadas que devolvem a recusa', () {
    setUp(() async {
      await ensureStorageReady();
      storageMorador({
        'token': 'token-sindico',
        'user': {'id': 1, 'nome': 'Ana'},
      });
      Singleton.instance.id_condominio = 22;
    });

    tearDown(() async {
      ApiClient.restaurarPadroes();
      await storageLogout();
      Singleton.instance.reset();
    });

    void responder(int status, Object corpo) {
      ApiClient.client = MockClient((_) async =>
          http.Response(corpo is String ? corpo : jsonEncode(corpo), status,
              headers: {'content-type': 'application/json; charset=utf-8'}));
    }

    test('excluir: 409 com message chega inteiro; o bool antigo continua', () async {
      responder(409, {'message': 'Esta reserva já aconteceu.', 'statusCode': 409});
      final r = await apiDeleteObjectResultado('areas-sociais/agendamento', 9);
      expect(r.ok, isFalse);
      expect(r.mensagem, 'Esta reserva já aconteceu.');
      expect(await apiDeleteObject('areas-sociais/agendamento', 9), isFalse);
    });

    test('excluir: 200 é sucesso nos dois', () async {
      responder(200, {'ok': true});
      expect((await apiDeleteObjectResultado('ocorrencias', 3)).ok, isTrue);
      expect(await apiDeleteObject('ocorrencias', 3), isTrue);
    });

    test('excluir: sem conexão não tem mensagem', () async {
      ApiClient.client = MockClient((_) async => throw http.ClientException('sem rede'));
      final r = await apiDeleteObjectResultado('ocorrencias', 3);
      expect(r.ok, isFalse);
      expect(r.mensagem, isNull);
    });

    test('encomenda: 409 de retirada e 400 de unidade chegam à tela', () async {
      responder(409, {'message': 'Só é possível corrigir a unidade de encomenda aguardando retirada.'});
      final upd = await apiUpdateEncomendaResultado(5, {'destinatario_apto': '101'});
      expect(upd.ok, isFalse);
      expect(upd.mensagem, 'Só é possível corrigir a unidade de encomenda aguardando retirada.');

      responder(400, {'message': 'Unidade não encontrada neste condomínio.'});
      final ins = await apiInsertEncomendaResultado({'destinatario_apto': '999'});
      expect(ins.ok, isFalse);
      expect(ins.mensagem, 'Unidade não encontrada neste condomínio.');
    });

    test('encomenda: sucesso continua sucesso, inclusive no bool antigo', () async {
      responder(200, {'id': 1});
      expect((await apiInsertEncomendaResultado({'destinatario_apto': '101'})).ok, isTrue);
      expect(await apiInsertEncomenda({'destinatario_apto': '101'}), isTrue);
      expect(await apiUpdateEncomenda(5, {'destinatario_apto': '101'}), isTrue);
    });

    test('enviar acesso: 400 de menor chega à tela; o throw antigo continua', () async {
      const msg = 'Operação não permitida para menores de 18 anos (16 anos informados).';
      responder(400, {'message': msg});
      final r = await apiSendCredentialsResultado(7);
      expect(r.ok, isFalse);
      expect(r.mensagem, msg);
      expect(apiSendCredentialsGeral(7), throwsA(isA<String>()));
    });

    test('cancelar reserva: recusa sem JSON não vira FormatException na tela', () async {
      responder(502, '<html>502</html>');
      expect(
        apiUpdateStatusAgendamento(9, 'cancelado'),
        throwsA(predicate((e) => e is String && !e.contains('Exception') && !e.contains('<html'))),
      );
    });

    test('cancelar reserva: 409 da API chega à tela', () async {
      responder(409, {'message': 'Esta reserva já aconteceu.'});
      expect(apiUpdateStatusAgendamento(9, 'cancelado'), throwsA('Esta reserva já aconteceu.'));
    });
  });
}
