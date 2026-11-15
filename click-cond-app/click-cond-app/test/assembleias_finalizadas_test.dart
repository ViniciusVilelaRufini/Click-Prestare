import 'dart:convert';

import 'package:click/pages/shared/assembleias/assembleia_helpers.dart';
import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/assembleias/list_assembleias.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/alerts/modal_finalizar_assembleia.dart';
import 'package:click/widgets/cells/cell_votacao.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Rodada 5 (assembleia robusta): finalizar não apaga mais. A lista pede
// `incluir_finalizadas=1` e mostra as finalizadas numa seção própria; o
// detalhe de uma finalizada é somente leitura, com o botão da ATA. API antiga
// (sem `finalizada`) = lista como antes.

const _json = {'content-type': 'application/json; charset=utf-8'};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('helpers', () {
    test('assembleiaFinalizada: só com o campo verdadeiro', () {
      expect(assembleiaFinalizada({'finalizada': true}), isTrue);
      expect(assembleiaFinalizada({'finalizada': 1}), isTrue);
      expect(assembleiaFinalizada({'finalizada': false}), isFalse);
      expect(assembleiaFinalizada(<String, dynamic>{}), isFalse);
      expect(assembleiaFinalizada(null), isFalse);
    });

    test('separarAssembleias mantém a ordem e separa as finalizadas', () {
      final s = separarAssembleias([
        {'id': 1},
        {'id': 2, 'finalizada': true},
        {'id': 3, 'finalizada': false},
        'lixo',
        {'id': 4, 'finalizada': true},
      ]);
      expect(s.abertas.map((a) => a['id']), [1, 3]);
      expect(s.finalizadas.map((a) => a['id']), [2, 4]);
      expect(separarAssembleias(null).abertas, isEmpty);
    });

    test('dataFinalizacao: ISO ou dd/MM/yyyy → dd/MM/yyyy; vazio/lixo → ""', () {
      expect(dataFinalizacao('2026-11-15T13:20:00.000Z'), '15/11/2026');
      expect(dataFinalizacao('2026-11-15'), '15/11/2026');
      expect(dataFinalizacao('15/11/2026'), '15/11/2026');
      expect(dataFinalizacao('15/11/2026 10:30'), '15/11/2026');
      expect(dataFinalizacao(null), '');
      expect(dataFinalizacao('ontem'), '');
    });

    test('linkAta: texto limpo ou nulo', () {
      expect(linkAta({'link_ata': ' https://x/ata.pdf '}), 'https://x/ata.pdf');
      expect(linkAta({'link_ata': null}), isNull);
      expect(linkAta(<String, dynamic>{}), isNull);
    });
  });

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester, Widget tela) async {
    tester.view.physicalSize = const Size(400 * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: tela));
    await tester.pumpAndSettle();
  }

  group('lista', () {
    late List<Map<String, String>> consultas;

    void servir(List<Map<String, dynamic>> lista) {
      consultas = [];
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get-all')) {
          consultas.add(request.url.queryParameters);
          return http.Response(jsonEncode(lista), 200, headers: _json);
        }
        return http.Response('', 404);
      });
    }

    testWidgets('pede incluir_finalizadas=1 e mostra a seção "Finalizadas"', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      servir([
        {'id': 1, 'titulo': 'AGO 2027', 'descricao': '', 'data': '10/01/2099', 'hora': '19:00', 'finalizada': false},
        {
          'id': 2,
          'titulo': 'AGE da fachada',
          'descricao': '',
          'data': '01/10/2026',
          'hora': '19:00',
          'finalizada': true,
          'finalizada_em': '2026-10-02T12:00:00.000Z',
        },
      ]);
      await abrir(tester, const ListAssembleias());

      expect(consultas.single['incluir_finalizadas'], '1');
      expect(consultas.single['id_condominio'], '22');
      expect(find.text('FINALIZADAS'), findsOneWidget);
      expect(find.text('Finalizada em 02/10/2026'), findsOneWidget);
      // Ordem: aberta, título da seção, finalizada.
      final yAberta = tester.getTopLeft(find.text('AGO 2027')).dy;
      final ySecao = tester.getTopLeft(find.text('FINALIZADAS')).dy;
      final yFinalizada = tester.getTopLeft(find.text('AGE da fachada')).dy;
      expect(yAberta < ySecao && ySecao < yFinalizada, isTrue);
    });

    testWidgets('API antiga (sem "finalizada"): sem seção, lista como antes', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      servir([
        {'id': 1, 'titulo': 'AGO 2027', 'descricao': '', 'data': '10/01/2099', 'hora': '19:00'},
      ]);
      await abrir(tester, const ListAssembleias());
      expect(find.text('FINALIZADAS'), findsNothing);
      expect(find.byType(AssembleiaCard), findsOneWidget);
    });

    testWidgets('só finalizadas: aviso de vazio e a seção abaixo', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      servir([
        {'id': 2, 'titulo': 'AGE da fachada', 'descricao': '', 'data': '01/10/2026', 'hora': '', 'finalizada': true},
      ]);
      await abrir(tester, const ListAssembleias());
      expect(find.text('Nenhuma assembleia marcada no momento.'), findsOneWidget);
      expect(find.text('FINALIZADAS'), findsOneWidget);
      expect(find.text('AGE da fachada'), findsOneWidget);
    });
  });

  group('detalhe finalizada', () {
    Map<String, dynamic> detalhe({String? link}) => {
          'assembleia': {
            'id': 5,
            'titulo': 'AGE da fachada',
            'descricao': '',
            'data': '01/10/2026',
            'hora': '19:00',
            'link': '',
            'local': '',
            'anexos': '',
            'finalizada': true,
            'finalizada_em': '2026-10-02T12:00:00.000Z',
            if (link != null) 'link_ata': link,
          },
          'votacoes': [
            {
              'id': 7,
              'titulo': 'Pintura',
              'descricao': '',
              'data_inicio': '01/10/2026',
              'data_termino': '01/10/2026',
              'status': 2,
              'opcoes': ['12;Sim;3', '13;Não;1'],
              'resultado_oculto': false,
            }
          ],
          'meusVotos': ['12'],
        };

    void servir(Map<String, dynamic> d) {
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get')) {
          return http.Response(jsonEncode(d), 200, headers: _json);
        }
        return http.Response('', 404);
      });
    }

    testWidgets('síndico: sem editar, finalizar, nova votação nem excluir; com a ATA', (tester) async {
      storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
      servir(detalhe(link: 'https://x/ata.pdf'));
      await abrir(tester, const DetailAssembleia(id: 5));

      expect(find.text('Assembleia finalizada em 02/10/2026'), findsOneWidget);
      expect(find.byKey(DetailAssembleia.chaveAbrirAta), findsOneWidget);
      expect(find.byTooltip('Editar assembleia'), findsNothing);
      expect(find.byTooltip('Finalizar assembleia'), findsNothing);
      expect(find.byKey(DetailAssembleia.chaveNovaVotacao), findsNothing);
      expect(find.byKey(CellVotacao.chaveExcluir(7)), findsNothing);
      expect(find.byKey(CellVotacao.chaveVotar(7)), findsNothing);
      expect(find.text('50%'), findsNothing);
      expect(find.text('75%'), findsOneWidget); // resultado final visível
    });

    testWidgets('sem link da ATA: sem botão', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      servir(detalhe());
      await abrir(tester, const DetailAssembleia(id: 5));
      expect(find.byKey(DetailAssembleia.chaveAbrirAta), findsNothing);
      expect(find.text('Assembleia finalizada em 02/10/2026'), findsOneWidget);
    });

    testWidgets('somente leitura mesmo com pauta aberta (status 1)', (tester) async {
      storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
      final d = detalhe();
      (d['votacoes'] as List).first['status'] = 1;
      d['meusVotos'] = [];
      servir(d);
      await abrir(tester, const DetailAssembleia(id: 5));
      expect(find.byType(OpcaoSelecionavel), findsNothing);
      expect(find.byKey(CellVotacao.chaveVotar(7)), findsNothing);
    });
  });

  testWidgets('modal de finalizar explica que nada é apagado', (tester) async {
    storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});
    await abrir(tester, const ModalFinalizarAssembleia(assembleia: {'id': 5, 'titulo': 'AGO', 'data': '01/10/2026'}));
    expect(find.text(ModalFinalizarAssembleia.textoNadaApagado), findsOneWidget);
    expect(ModalFinalizarAssembleia.textoNadaApagado,
        'A assembleia fica guardada no histórico com as votações; nada é apagado.');
  });
}
