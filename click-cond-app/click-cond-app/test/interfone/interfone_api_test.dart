import 'dart:convert';

import 'package:click/services/interfone/interfone_api.dart';
import 'package:click/utils/api_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _dadosEntrada = {
  'id': 41,
  'token': 'tok.curto',
  'wss': 'wss://voz.prestarecondominios.com.br:8089/ws',
  'sip_uri': 'sip:entrar@voz.prestarecondominios.com.br',
  'ice': [
    {
      'urls': ['stun:voz.prestarecondominios.com.br:3478'],
    },
    {
      'urls': [
        'turn:voz.prestarecondominios.com.br:3478?transport=udp',
        'turn:voz.prestarecondominios.com.br:3478?transport=tcp',
      ],
      'username': '1700003600:7',
      'credential': 'abc=',
    },
  ],
};

void main() {
  late List<http.Request> pedidos;

  void responder(http.Response Function(http.Request r) fn) {
    pedidos = [];
    ApiClient.client = MockClient((r) async {
      pedidos.add(r);
      return fn(r);
    });
  }

  setUp(() {
    ApiClient.tokenProvider = () => 'sessao-morador';
  });

  tearDown(ApiClient.restaurarPadroes);

  group('DadosEntrada', () {
    test('lê o contrato com ICE de várias URLs', () {
      final d = DadosEntrada.fromJson(_dadosEntrada);
      expect(d.id, 41);
      expect(d.token, 'tok.curto');
      expect(d.wss, 'wss://voz.prestarecondominios.com.br:8089/ws');
      expect(d.sipUri, 'sip:entrar@voz.prestarecondominios.com.br');
      expect(d.ice, hasLength(2));
      expect(d.ice.first.urls, ['stun:voz.prestarecondominios.com.br:3478']);
      expect(d.ice.first.username, isNull);
      expect(d.ice.last.urls, hasLength(2));
      expect(d.ice.last.username, '1700003600:7');
      expect(d.ice.last.credential, 'abc=');
    });

    test('aceita urls como texto solto (forma do WebRTC)', () {
      final d = DadosEntrada.fromJson({
        ..._dadosEntrada,
        'ice': [
          {'urls': 'stun:voz.prestarecondominios.com.br:3478'},
        ],
      });
      expect(d.ice.single.urls, ['stun:voz.prestarecondominios.com.br:3478']);
    });
  });

  group('EstadoChamada', () {
    test('lê o contrato', () {
      final e = EstadoChamada.fromJson({
        'id': 41,
        'tipo': 'facial_unidade',
        'estado': 'chamando',
        'resultado': null,
        'unidade': 'Bloco A · Apto 106',
        'portao': 'Portão social',
        'foto_url': 'https://s3/foto.jpg',
        'atendida_por_mim': false,
      });
      expect(e.id, 41);
      expect(e.tipo, 'facial_unidade');
      expect(e.estado, 'chamando');
      expect(e.resultado, isNull);
      expect(e.unidade, 'Bloco A · Apto 106');
      expect(e.portao, 'Portão social');
      expect(e.fotoUrl, 'https://s3/foto.jpg');
      expect(e.atendidaPorMim, isFalse);
      expect(e.ehDoFacial, isTrue);
    });
  });

  group('InterfoneApi', () {
    test('disponivel lê {ativo}', () async {
      responder((_) => http.Response(jsonEncode({'ativo': true}), 200));
      expect(await InterfoneApi.disponivel(), isTrue);
      expect(pedidos.single.method, 'GET');
      expect(pedidos.single.url.path, '/api/interfone/disponivel');
      expect(pedidos.single.headers['Authorization'], 'sessao-morador');
    });

    test('disponivel é false em erro ou sem rede', () async {
      responder((_) => http.Response('{}', 500));
      expect(await InterfoneApi.disponivel(), isFalse);
      ApiClient.client = MockClient((_) async => throw http.ClientException('sem rede'));
      expect(await InterfoneApi.disponivel(), isFalse);
    });

    test('estado consulta a chamada', () async {
      responder((_) => http.Response(
          jsonEncode({
            'id': 41,
            'tipo': 'facial_unidade',
            'estado': 'atendida',
            'resultado': null,
            'unidade': 'Bloco A · Apto 106',
            'portao': 'Portão',
            'foto_url': null,
            'atendida_por_mim': true,
          }),
          200));
      final e = await InterfoneApi.estado(41);
      expect(e?.estado, 'atendida');
      expect(e?.atendidaPorMim, isTrue);
      expect(pedidos.single.url.path, '/api/interfone/chamadas/41');
    });

    test('estado é null em erro', () async {
      responder((_) => http.Response('{}', 404));
      expect(await InterfoneApi.estado(41), isNull);
    });

    test('atender devolve DadosEntrada', () async {
      responder((_) => http.Response(jsonEncode(_dadosEntrada), 201));
      final d = await InterfoneApi.atender(41);
      expect(d?.token, 'tok.curto');
      expect(pedidos.single.method, 'POST');
      expect(pedidos.single.url.path, '/api/interfone/chamadas/41/atender');
    });

    test('atender com 409 devolve null e o motivo', () async {
      responder((_) => http.Response(jsonEncode({'motivo': 'ja_atendida'}), 409));
      expect(await InterfoneApi.atender(41), isNull);
      final r = await InterfoneApi.atenderComMotivo(41);
      expect(r.dados, isNull);
      expect(r.motivo, 'ja_atendida');
    });

    test('motivo do 409 também vem dentro de message (exceção do Nest)', () async {
      responder((_) => http.Response(
          jsonEncode({
            'statusCode': 409,
            'message': {'motivo': 'encerrada'},
          }),
          409));
      final r = await InterfoneApi.atenderComMotivo(41);
      expect(r.motivo, 'encerrada');
    });

    test('recusar faz POST', () async {
      responder((_) => http.Response(jsonEncode({'ok': true}), 201));
      expect(await InterfoneApi.recusar(41), isTrue);
      expect(pedidos.single.url.path, '/api/interfone/chamadas/41/recusar');
    });

    test('abrir devolve ok e motivo', () async {
      responder((_) => http.Response(jsonEncode({'ok': false, 'motivo': 'Agente offline'}), 201));
      final r = await InterfoneApi.abrir(41);
      expect(r.ok, isFalse);
      expect(r.motivo, 'Agente offline');
      expect(pedidos.single.url.path, '/api/interfone/chamadas/41/abrir');
    });

    test('abrir sem rede não lança', () async {
      ApiClient.client = MockClient((_) async => throw http.ClientException('sem rede'));
      final r = await InterfoneApi.abrir(41);
      expect(r.ok, isFalse);
      expect(r.motivo, isNotNull);
    });

    test('ligarPortaria manda a unidade e lê DadosEntrada', () async {
      responder((_) => http.Response(jsonEncode(_dadosEntrada), 201));
      final d = await InterfoneApi.ligarPortaria(22);
      expect(d?.id, 41);
      expect(pedidos.single.url.path, '/api/interfone/ligar-portaria');
      expect(jsonDecode(pedidos.single.body), {'id_apartamento': 22});
    });

    test('ligarPortaria com 409 devolve null e motivo', () async {
      responder((_) => http.Response(jsonEncode({'motivo': 'portaria_indisponivel'}), 409));
      final r = await InterfoneApi.ligarPortariaComMotivo(22);
      expect(r.dados, isNull);
      expect(r.motivo, 'portaria_indisponivel');
    });

    test('historico lê a lista', () async {
      responder((_) => http.Response(
          jsonEncode([
            {
              'id': 9,
              'tipo': 'facial_unidade',
              'inicio': '2026-11-27T13:05:00.000Z',
              'resultado': 'atendida_morador',
              'atendida_por_nome': 'Ana',
              'foto_url': null,
              'porta_aberta': true,
            },
          ]),
          200));
      final itens = await InterfoneApi.historico(22);
      expect(itens, hasLength(1));
      expect(itens!.single.id, 9);
      expect(itens.single.inicio, DateTime.utc(2026, 11, 27, 13, 5));
      expect(itens.single.atendidaPorNome, 'Ana');
      expect(itens.single.portaAberta, isTrue);
      expect(pedidos.single.url.path, '/api/interfone/historico');
      expect(pedidos.single.url.queryParameters['id_apartamento'], '22');
    });

    test('historico é null em erro', () async {
      responder((_) => http.Response('{}', 403));
      expect(await InterfoneApi.historico(22), isNull);
    });

    test('preferencia lê e grava', () async {
      responder((r) => http.Response(jsonEncode({'receber': r.method == 'GET' ? false : true}), 200));
      expect(await InterfoneApi.preferencia(), isFalse);
      expect(await InterfoneApi.definirPreferencia(true), isTrue);
      expect(pedidos.last.method, 'PUT');
      expect(pedidos.last.url.path, '/api/interfone/preferencia');
      expect(jsonDecode(pedidos.last.body), {'receber': true});
    });

    test('preferencia é null em erro', () async {
      responder((_) => http.Response('{}', 500));
      expect(await InterfoneApi.preferencia(), isNull);
      expect(await InterfoneApi.definirPreferencia(false), isFalse);
    });
  });
}
