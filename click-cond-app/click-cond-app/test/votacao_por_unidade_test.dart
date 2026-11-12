import 'dart:convert';

import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/utils/localizable/localizable.dart';
import 'package:click/widgets/cells/cell_votacao.dart';
import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:click/widgets/votacao/seletor_unidade_voto.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Voto por UNIDADE: quem tem mais de uma unidade no condomínio escolhe por
/// qual vota (cada unidade tem um voto) e vê o voto atual de cada uma. A API
/// devolve `votosPorUnidade: [{ id_votacao, id_apto, rotulo, opcao }]` no
/// detalhe da enquete e da assembleia, e recebe `id_apto` no voto.
/// Com uma unidade a tela não muda (só passa a mandar `id_apto`).

List<Map<String, dynamic>> votosDuasUnidades(int idVotacao, {String? opcao200 = '12', String? opcao300}) => [
      {'id_votacao': idVotacao, 'id_apto': 200, 'rotulo': 'Apto 21 Bloco A', 'opcao': opcao200},
      {'id_votacao': idVotacao, 'id_apto': 300, 'rotulo': 'Apto 31', 'opcao': opcao300},
    ];

const unidadesDuas = [
  {'id_apto': 200, 'rotulo': 'Apto 21 Bloco A'},
  {'id_apto': 300, 'rotulo': 'Apto 31'},
];

Map<String, dynamic> enquete({List<Map<String, dynamic>>? votosPorUnidade, List<dynamic>? unidades, List<String> meuVoto = const []}) => {
      'votacao': {
        'id': 7,
        'titulo': 'Cor da fachada',
        'descricao': '',
        'data_inicio': '01/10/2026',
        'data_termino': '30/10/2099',
        'status': 1,
        'opcoes': ['12;Azul;1', '13;Branco;0'],
      },
      'meuVoto': meuVoto,
      if (unidades != null) 'unidades': unidades,
      if (votosPorUnidade != null) 'votosPorUnidade': votosPorUnidade,
    };

Map<String, dynamic> assembleia({List<Map<String, dynamic>>? votosPorUnidade, List<dynamic>? unidades, List<String> meusVotos = const ['12']}) => {
      'assembleia': {
        'id': 5,
        'titulo': 'AGO',
        'descricao': '',
        'data': '11/10/2026',
        'hora': '19:30',
        'link': '',
        'local': '',
        'anexos': '',
      },
      'votacoes': [
        {
          'id': 7,
          'titulo': 'Aprovação das contas',
          'descricao': '',
          'data_inicio': '01/10/2026',
          'data_termino': '30/10/2099',
          'status': 1,
          'opcoes': ['12;Aprovo;1', '13;Reprovo;0'],
        },
      ],
      'meusVotos': meusVotos,
      if (unidades != null) 'unidades': unidades,
      if (votosPorUnidade != null) 'votosPorUnidade': votosPorUnidade,
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('helpers', () {
    test('unidadesDaVotacao: só as linhas da votação, na ordem da API', () {
      final u = unidadesDaVotacao([
        ...votosDuasUnidades(7),
        {'id_votacao': 8, 'id_apto': 200, 'rotulo': 'Apto 21 Bloco A', 'opcao': '99'},
      ], 7);
      expect(u.map((x) => [x.idApto, x.rotulo, x.opcao]).toList(), [
        [200, 'Apto 21 Bloco A', '12'],
        [300, 'Apto 31', null],
      ]);
    });

    test('unidadesDaVotacao: API antiga (sem o campo) ou lixo → vazio', () {
      expect(unidadesDaVotacao(null, 7), isEmpty);
      expect(unidadesDaVotacao('x', 7), isEmpty);
      expect(unidadesDaVotacao([{'id_votacao': 7, 'rotulo': 'sem id'}], 7), isEmpty);
      // id em texto também serve (a API manda número, mas o app compara como texto).
      expect(unidadesDaVotacao([{'id_votacao': '7', 'id_apto': '200', 'rotulo': 'A', 'opcao': 12}], 7).single.opcao, '12');
    });

    test('unidadePadrao: mantém a escolha; senão a primeira sem voto; senão a primeira', () {
      final u = unidadesDaVotacao(votosDuasUnidades(7), 7);
      expect(unidadePadrao(u), 300);
      expect(unidadePadrao(u, atual: 200), 200);
      expect(unidadePadrao(u, atual: 999), 300);
      expect(unidadePadrao(unidadesDaVotacao(votosDuasUnidades(7, opcao300: '13'), 7)), 200);
      expect(unidadePadrao(const []), isNull);
    });

    test('textos novos existem em pt_BR', () {
      expect(getText('votacao_unidade_titulo'), 'Votar pela unidade');
      expect(getText('votacao_unidade_sem_voto'), 'Ainda não votou');
    });
  });

  late List<Map<String, dynamic>> votosEnviados;
  late int chamadas;

  void servir(List<Map<String, dynamic>> respostas) {
    votosEnviados = [];
    chamadas = 0;
    ApiClient.client = MockClient((request) async {
      const json = {'content-type': 'application/json; charset=utf-8'};
      final path = request.url.path;
      if (path.endsWith('/assembleias/votacoes/enquetes/get') || path.endsWith('/assembleias/get')) {
        final r = respostas[chamadas.clamp(0, respostas.length - 1)];
        chamadas++;
        return http.Response(jsonEncode(r), 200, headers: json);
      }
      if (path.endsWith('/assembleias/votacoes/voto/insert')) {
        final corpo = jsonDecode(request.body) as Map<String, dynamic>;
        expect(corpo['id_condominio'], '22');
        votosEnviados.add(corpo['voto'] as Map<String, dynamic>);
        return http.Response('{}', 200, headers: json);
      }
      return http.Response('', 404);
    });
  }

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
    storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester, Widget tela) async {
    tester.view.physicalSize = const Size(360 * 3, 1400 * 3);
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

  group('enquete', () {
    testWidgets('duas unidades: mostra o seletor com o voto de cada uma e vota pela escolhida', (tester) async {
      servir([enquete(unidades: unidadesDuas, votosPorUnidade: votosDuasUnidades(7), meuVoto: ['12'])]);
      await abrir(tester, const DetailEnquete(id: 7));

      expect(find.byType(SeletorUnidadeVoto), findsOneWidget);
      expect(find.text('Votar pela unidade'.toUpperCase()), findsOneWidget);
      expect(find.text('Apto 21 Bloco A'), findsOneWidget);
      expect(find.text('Apto 31'), findsOneWidget);
      // Voto atual de cada unidade.
      expect(find.text('Voto atual: Azul'), findsOneWidget);
      expect(find.text('Ainda não votou'), findsOneWidget);

      // Abre na unidade que ainda não votou: dá para escolher a opção.
      final seletor = tester.widget<SeletorUnidadeVoto>(find.byType(SeletorUnidadeVoto));
      expect(seletor.selecionada, 300);
      expect(find.byType(OpcaoSelecionavel), findsNWidgets(2));

      await tocar(tester, find.text('Branco'));
      await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
      expect(votosEnviados, [
        {'votacao_id': 7, 'opcao_id': 13, 'id_apto': 300},
      ]);
    });

    testWidgets('trocar para a unidade que já votou mostra o resultado com o voto dela', (tester) async {
      servir([enquete(unidades: unidadesDuas, votosPorUnidade: votosDuasUnidades(7))]);
      await abrir(tester, const DetailEnquete(id: 7));

      await tocar(tester, find.byKey(SeletorUnidadeVoto.chaveUnidade(7, 200)));
      expect(tester.widget<SeletorUnidadeVoto>(find.byType(SeletorUnidadeVoto)).selecionada, 200);
      expect(find.text('Você já votou'), findsOneWidget);
      final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
      expect(barras.map((b) => b.meuVoto), [true, false]);

      // Alterar o voto desta unidade manda o id_apto dela.
      await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar)); // "Alterar voto"
      await tocar(tester, find.text('Branco'));
      await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar)); // "Confirmar voto"
      expect(votosEnviados, [
        {'votacao_id': 7, 'opcao_id': 13, 'id_apto': 200},
      ]);
    });

    testWidgets('uma unidade: sem seletor, tela igual, voto leva o id_apto', (tester) async {
      servir([
        enquete(
          unidades: const [{'id_apto': 300, 'rotulo': 'Apto 31'}],
          votosPorUnidade: [votosDuasUnidades(7)[1]],
        ),
      ]);
      await abrir(tester, const DetailEnquete(id: 7));

      expect(find.byType(SeletorUnidadeVoto), findsNothing);
      expect(find.text('Votação aberta'), findsOneWidget);
      await tocar(tester, find.text('Azul'));
      await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
      expect(votosEnviados, [
        {'votacao_id': 7, 'opcao_id': 12, 'id_apto': 300},
      ]);
    });

    testWidgets('API antiga (sem votosPorUnidade): sem seletor e voto sem id_apto', (tester) async {
      servir([enquete()]);
      await abrir(tester, const DetailEnquete(id: 7));

      expect(find.byType(SeletorUnidadeVoto), findsNothing);
      await tocar(tester, find.text('Azul'));
      await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
      expect(votosEnviados, [
        {'votacao_id': 7, 'opcao_id': 12},
      ]);
    });
  });

  group('assembleia', () {
    testWidgets('duas unidades: a votação mostra o seletor e vota pela unidade escolhida', (tester) async {
      servir([assembleia(unidades: unidadesDuas, votosPorUnidade: votosDuasUnidades(7))]);
      await abrir(tester, const DetailAssembleia(id: 5));

      expect(find.byType(SeletorUnidadeVoto), findsOneWidget);
      expect(find.text('Voto atual: Aprovo'), findsOneWidget);
      expect(find.text('Ainda não votou'), findsOneWidget);
      // Abre na unidade 300 (sem voto): opções para escolher, apesar de
      // `meusVotos` (campo antigo) dizer que a conta já votou.
      expect(find.byType(OpcaoSelecionavel), findsNWidgets(2));

      await tocar(tester, find.text('Reprovo'));
      await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
      expect(votosEnviados, [
        {'votacao_id': 7, 'opcao_id': 13, 'id_apto': 300},
      ]);
    });

    testWidgets('uma unidade: sem seletor e o voto leva o id_apto', (tester) async {
      servir([
        assembleia(
          unidades: const [{'id_apto': 200, 'rotulo': 'Apto 21 Bloco A'}],
          votosPorUnidade: [votosDuasUnidades(7, opcao200: null)[0]],
          meusVotos: const [],
        ),
      ]);
      await abrir(tester, const DetailAssembleia(id: 5));

      expect(find.byType(SeletorUnidadeVoto), findsNothing);
      await tocar(tester, find.text('Reprovo'));
      await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
      expect(votosEnviados, [
        {'votacao_id': 7, 'opcao_id': 13, 'id_apto': 200},
      ]);
    });
  });
}
