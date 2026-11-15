import 'dart:convert';

import 'package:click/controllers/controller_enquetes.dart';
import 'package:click/controllers/controller_generic.dart';
import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/cells/cell_votacao.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Rodada 5 (assembleia robusta): as recusas novas da API (409 do inquilino
// que tenta trocar o voto do proprietário, 400 de pauta com votos, de
// assembleia finalizada...) chegam ao usuário como vieram, filtradas por
// `mensagemCurtaDaApi`; texto técnico vira o genérico da tela.

const _json = {'content-type': 'application/json; charset=utf-8'};
const _msg409 = 'O proprietário da unidade já votou; o voto dele não pode ser alterado por inquilino.';

Map<String, dynamic> _pauta() => {
      'id': 7,
      'titulo': 'Aprovação das contas',
      'descricao': '',
      'data_inicio': '01/10/2026',
      'data_termino': '30/10/2099',
      'status': 1,
      'opcoes': ['12;Aprovo;0', '13;Reprovo;0'],
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  group('apiSaveObjectResultado', () {
    test('2xx = sucesso e manda o mesmo corpo de apiSaveObject', () async {
      Map<String, dynamic>? corpo;
      ApiClient.client = MockClient((r) async {
        corpo = jsonDecode(r.body) as Map<String, dynamic>;
        expect(r.url.path, endsWith('/assembleias/votacoes/voto/insert'));
        return http.Response('{}', 201, headers: _json);
      });
      final r = await apiSaveObjectResultado('assembleias/votacoes/voto', 'voto', {'votacao_id': 7, 'opcao_id': 12});
      expect(r.ok, isTrue);
      expect(corpo, {
        'id_condominio': '22',
        'voto': {'votacao_id': 7, 'opcao_id': 12},
      });
    });

    test('recusa com message: a mensagem; texto técnico: nulo', () async {
      ApiClient.client = MockClient((r) async => http.Response(jsonEncode({'message': _msg409}), 409, headers: _json));
      var r = await apiSaveObjectResultado('x', 'voto', {});
      expect(r.ok, isFalse);
      expect(r.mensagem, _msg409);

      ApiClient.client = MockClient((r) async => http.Response(
          jsonEncode({'message': 'PrismaClientKnownRequestError: Unique constraint'}), 500,
          headers: _json));
      r = await apiSaveObjectResultado('x', 'voto', {});
      expect(r.ok, isFalse);
      expect(r.mensagem, isNull);
      expect(r.mensagemOu('genérico'), 'genérico');
    });

    test('sem conexão: falha com o texto de comunicação', () async {
      ApiClient.client = MockClient((r) async => throw http.ClientException('sem rede'));
      final r = await apiSaveObjectResultado('x', 'voto', {});
      expect(r.ok, isFalse);
      expect(r.mensagem, 'Falha de comunicação com o servidor. Verifique sua conexão.');
    });
  });

  group('apiFinishEnquete', () {
    test('repassa a mensagem da API em vez do genérico', () async {
      ApiClient.client = MockClient(
          (r) async => http.Response(jsonEncode({'message': 'Assembleia já finalizada.'}), 400, headers: _json));
      await expectLater(apiFinishEnquete('7'), throwsA('Assembleia já finalizada.'));
    });

    test('201 também é sucesso', () async {
      ApiClient.client = MockClient((r) async => http.Response('{}', 201, headers: _json));
      await apiFinishEnquete('7');
    });
  });

  group('telas', () {
    Future<void> abrir(WidgetTester tester, Widget tela) async {
      tester.view.physicalSize = const Size(600 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: tela));
      await tester.pumpAndSettle();
    }

    Future<void> tocar(WidgetTester tester, Finder f) async {
      await tester.ensureVisible(f);
      await tester.pumpAndSettle();
      await tester.tap(f);
      await tester.pumpAndSettle();
    }

    testWidgets('assembleia: 409 ao votar mostra a mensagem da API', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get')) {
          return http.Response(
              jsonEncode({
                'assembleia': {'id': 5, 'titulo': 'AGO', 'data': '11/10/2026', 'hora': ''},
                'votacoes': [_pauta()],
                'meusVotos': [],
              }),
              200,
              headers: _json);
        }
        if (request.url.path.endsWith('/assembleias/votacoes/voto/insert')) {
          return http.Response(jsonEncode({'message': _msg409}), 409, headers: _json);
        }
        return http.Response('', 404);
      });
      await abrir(tester, const DetailAssembleia(id: 5));
      await tocar(tester, find.text('Aprovo'));
      await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
      expect(find.text(_msg409), findsOneWidget);
    });

    testWidgets('assembleia: erro técnico ao votar vira o texto genérico', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get')) {
          return http.Response(
              jsonEncode({
                'assembleia': {'id': 5, 'titulo': 'AGO', 'data': '11/10/2026', 'hora': ''},
                'votacoes': [_pauta()],
                'meusVotos': [],
              }),
              200,
              headers: _json);
        }
        if (request.url.path.endsWith('/assembleias/votacoes/voto/insert')) {
          return http.Response(jsonEncode({'message': 'TypeError: Cannot read properties of undefined'}), 500,
              headers: _json);
        }
        return http.Response('', 404);
      });
      await abrir(tester, const DetailAssembleia(id: 5));
      await tocar(tester, find.text('Aprovo'));
      await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
      expect(find.text('Houve um erro, tente novamente!'), findsOneWidget);
      expect(find.textContaining('TypeError'), findsNothing);
    });

    testWidgets('síndico: excluir pauta com votos mostra a recusa da API', (tester) async {
      storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
      const recusa = 'Esta pauta já tem votos e não pode ser excluída. Encerre a votação.';
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get')) {
          return http.Response(
              jsonEncode({
                'assembleia': {'id': 5, 'titulo': 'AGO', 'data': '11/10/2026', 'hora': ''},
                'votacoes': [_pauta()],
                'meusVotos': [],
              }),
              200,
              headers: _json);
        }
        if (request.url.path.endsWith('/assembleias/votacoes/remove')) {
          return http.Response(jsonEncode({'message': recusa}), 400, headers: _json);
        }
        return http.Response('', 404);
      });
      await abrir(tester, const DetailAssembleia(id: 5));
      await tocar(tester, find.byKey(CellVotacao.chaveExcluir(7)));
      await tester.tap(find.text('Sim'));
      await tester.pumpAndSettle();
      expect(find.text(recusa), findsOneWidget);
    });

    testWidgets('enquete: 409 ao votar mostra a mensagem da API', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/votacoes/enquetes/get')) {
          return http.Response(jsonEncode({'votacao': _pauta(), 'meuVoto': []}), 200, headers: _json);
        }
        if (request.url.path.endsWith('/assembleias/votacoes/voto/insert')) {
          return http.Response(jsonEncode({'message': _msg409}), 409, headers: _json);
        }
        return http.Response('', 404);
      });
      await abrir(tester, const DetailEnquete(id: 7));
      await tocar(tester, find.text('Aprovo'));
      await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
      expect(find.text(_msg409), findsOneWidget);
    });
  });
}
