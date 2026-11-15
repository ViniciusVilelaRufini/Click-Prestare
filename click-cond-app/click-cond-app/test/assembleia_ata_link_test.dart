import 'dart:convert';

import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/assembleia_helpers.dart';
import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Revisão r5: o link assinado da ATA expira com a tela aberta (A7) — o app
// confere, recarrega o detalhe uma vez e tenta de novo antes do erro. E o
// sucesso do finish mostra a `message` que a API devolve.

const _json = {'content-type': 'application/json; charset=utf-8'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('linkAtaValido', () {
    test('2xx/3xx sim, 4xx não, 5xx não sabe', () {
      expect(linkAtaValido(200), isTrue);
      expect(linkAtaValido(206), isTrue);
      expect(linkAtaValido(302), isTrue);
      expect(linkAtaValido(403), isFalse);
      expect(linkAtaValido(404), isFalse);
      expect(linkAtaValido(500), isNull);
    });
  });

  group('mensagem de sucesso', () {
    const msg = 'Assembléia Finalizada!\nA ATA se encontra disponível no menu "Docs" na tela de seu condomínio.';

    test('ResultadoApi guarda a message do 2xx; recusa continua em mensagem', () {
      final ok = ResultadoApi.daResposta(201, jsonEncode({'message': msg}));
      expect(ok.ok, isTrue);
      expect(ok.mensagemSucesso, msg);
      expect(ok.mensagem, isNull);
      expect(ResultadoApi.daResposta(200, '{"ok":true}').mensagemSucesso, isNull);
      expect(ResultadoApi.daResposta(400, jsonEncode({'message': 'Assembleia já finalizada.'})).mensagemSucesso,
          isNull);
    });

    test('apiSaveObjectResultado do finish traz a message', () async {
      Singleton.instance.id_condominio = 22;
      ApiClient.client = MockClient((r) async {
        expect(r.url.path, endsWith('/assembleias/finish/insert'));
        return http.Response(jsonEncode({'message': msg}), 201, headers: _json);
      });
      final r = await apiSaveObjectResultado('assembleias/finish', 'assembleia', {'id': 5});
      expect(r.mensagemSucesso, msg);
      ApiClient.restaurarPadroes();
      Singleton.instance.reset();
    });
  });

  group('Abrir ATA', () {
    late int chamadasDetalhe;
    late List<String> abertos;
    late List<String> conferidos;

    setUp(() async {
      await ensureStorageReady();
      Singleton.instance.id_condominio = 22;
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      chamadasDetalhe = 0;
      abertos = [];
      conferidos = [];
      DetailAssembleia.abrirLink = (url, _) async => abertos.add(url);
    });

    tearDown(() async {
      DetailAssembleia.restaurarPadroes();
      ApiClient.restaurarPadroes();
      await storageLogout();
      Singleton.instance.reset();
    });

    /// [links] é o `link_ata` de cada GET do detalhe (o último se repete);
    /// [s3] responde a conferência de cada link.
    void servir(List<String> links, int Function(String url) s3) {
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get')) {
          final link = links[chamadasDetalhe.clamp(0, links.length - 1)];
          chamadasDetalhe++;
          return http.Response(
              jsonEncode({
                'assembleia': {
                  'id': 5,
                  'titulo': 'AGE',
                  'data': '01/10/2026',
                  'hora': '',
                  'finalizada': true,
                  'finalizada_em': '2026-10-02T12:00:00.000Z',
                  'link_ata': link,
                },
                'votacoes': [],
                'meusVotos': [],
              }),
              200,
              headers: _json);
        }
        if (request.url.host == 's3.test') {
          final url = request.url.toString();
          conferidos.add(url);
          expect(request.headers['Authorization'], isNull, reason: 'o S3 recusa o token da sessão');
          expect(request.headers['Range'], 'bytes=0-0');
          return http.Response('%', s3(url));
        }
        return http.Response('', 404);
      });
    }

    Future<void> tocarAta(WidgetTester tester) async {
      tester.view.physicalSize = const Size(400 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: DetailAssembleia(id: 5)));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(DetailAssembleia.chaveAbrirAta));
      await tester.pumpAndSettle();
    }

    testWidgets('link válido: abre sem recarregar', (tester) async {
      servir(['https://s3.test/ata.pdf?sig=1'], (_) => 206);
      await tocarAta(tester);
      expect(abertos, ['https://s3.test/ata.pdf?sig=1']);
      expect(chamadasDetalhe, 1);
    });

    testWidgets('assinatura expirada: recarrega uma vez e abre o link novo', (tester) async {
      servir(['https://s3.test/ata.pdf?sig=velha', 'https://s3.test/ata.pdf?sig=nova'],
          (url) => url.contains('velha') ? 403 : 206);
      await tocarAta(tester);
      expect(chamadasDetalhe, 2);
      expect(conferidos, ['https://s3.test/ata.pdf?sig=velha', 'https://s3.test/ata.pdf?sig=nova']);
      expect(abertos, ['https://s3.test/ata.pdf?sig=nova']);
    });

    testWidgets('continua recusando depois de recarregar: erro, sem abrir', (tester) async {
      servir(['https://s3.test/ata.pdf?sig=1'], (_) => 403);
      await tocarAta(tester);
      expect(chamadasDetalhe, 2, reason: 'recarrega uma vez só');
      expect(abertos, isEmpty);
      expect(find.text(DetailAssembleia.erroAbrirAta), findsOneWidget);
    });

    testWidgets('sem como conferir (5xx): abre assim mesmo', (tester) async {
      servir(['https://s3.test/ata.pdf?sig=1'], (_) => 503);
      await tocarAta(tester);
      expect(abertos, ['https://s3.test/ata.pdf?sig=1']);
      expect(chamadasDetalhe, 1);
    });
  });
}
