import 'dart:convert';

import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/cells/cell_votacao.dart';
import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:click/widgets/votacao/votacao_status_badge.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> votacao({
  int id = 7,
  int status = 1,
  String titulo = 'Aprovação das contas de 2025',
  List<String> opcoes = const ['12;Aprovo;1', '13;Reprovo;1', '14;Abstenção;1'],
}) =>
    {
      'id': id,
      'titulo': titulo,
      'descricao': 'Balancete enviado por e-mail.',
      'data_inicio': '01/10/2026',
      'data_termino': '30/10/2026',
      'status': status,
      'opcoes': opcoes,
    };

/// Formato real de `assembleias/get` (assembleias.service.ts → get).
Map<String, dynamic> detalhe({
  List<Map<String, dynamic>>? votacoes,
  List<String> meusVotos = const [],
  String anexos = '',
}) =>
    {
      'assembleia': {
        'id': 5,
        'titulo': 'Assembleia Geral Ordinária',
        'descricao': 'Aprovação de contas e eleição do síndico.',
        'data': '11/10/2026',
        'hora': '19:30',
        'link': '',
        'local': 'Salão de festas',
        'anexos': anexos,
      },
      'votacoes': votacoes ?? [votacao()],
      'meusVotos': meusVotos,
    };

void entrarComoMorador() => storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
void entrarComoSindico() => storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late int chamadasDetalhe;
  late List<Map<String, dynamic>> votosEnviados;
  late List<Map<String, dynamic>> remocoes;

  /// [respostas] é servida em ordem a cada GET do detalhe (a última se repete).
  void servir(List<Map<String, dynamic>> respostas, {http.Response Function()? respostaVoto}) {
    chamadasDetalhe = 0;
    votosEnviados = [];
    remocoes = [];
    ApiClient.client = MockClient((request) async {
      const json = {'content-type': 'application/json; charset=utf-8'};
      final path = request.url.path;
      if (path.endsWith('/assembleias/get')) {
        expect(request.url.queryParameters['id'], '5');
        final r = respostas[chamadasDetalhe.clamp(0, respostas.length - 1)];
        chamadasDetalhe++;
        return http.Response(jsonEncode(r), 200, headers: json);
      }
      if (path.endsWith('/assembleias/votacoes/voto/insert')) {
        votosEnviados.add(jsonDecode(request.body) as Map<String, dynamic>);
        return respostaVoto?.call() ?? http.Response('{}', 200, headers: json);
      }
      if (path.endsWith('/assembleias/votacoes/remove')) {
        remocoes.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response('{}', 201, headers: json);
      }
      return http.Response('', 404);
    });
  }

  setUp(() async {
    await ensureStorageReady();
    Singleton.instance.id_condominio = 22;
  });

  tearDown(() async {
    ApiClient.restaurarPadroes();
    await storageLogout();
    Singleton.instance.reset();
  });

  Future<void> abrir(WidgetTester tester, {double largura = 360, ThemeData? tema}) async {
    tester.view.physicalSize = Size(largura * 3, 900 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(theme: tema, home: const DetailAssembleia(id: 5)));
    await tester.pumpAndSettle();
  }

  Future<void> tocar(WidgetTester tester, Finder f) async {
    await tester.ensureVisible(f);
    await tester.pumpAndSettle();
    await tester.tap(f);
    await tester.pumpAndSettle();
  }

  AppButton botao(WidgetTester tester, {int id = 7}) =>
      tester.widget<AppButton>(find.byKey(CellVotacao.chaveVotar(id)));

  testWidgets('cabeçalho com data por extenso, local e descrição; votação com selo, prazo e opções',
      (tester) async {
    entrarComoMorador();
    servir([detalhe()]);
    await abrir(tester);

    expect(find.text('Assembleia'), findsOneWidget); // título da tela
    expect(find.text('Assembleia Geral Ordinária'), findsOneWidget);
    expect(find.text('Domingo, 11 de outubro de 2026 às 19:30'), findsOneWidget);
    expect(find.text('Salão de festas'), findsOneWidget);
    expect(find.text('Aprovação de contas e eleição do síndico.'), findsOneWidget);
    // Nada de chave crua de tradução na tela.
    expect(find.textContaining('as_hora'), findsNothing);
    expect(find.textContaining('nova_votacao'), findsNothing);

    expect(find.byType(CellVotacao), findsOneWidget);
    expect(find.byType(VotacaoStatusBadge), findsOneWidget);
    expect(find.text('Em andamento'), findsOneWidget);
    expect(find.text('01/10/2026 a 30/10/2026'), findsOneWidget);
    expect(find.text('3 votos'), findsOneWidget);
    expect(find.byType(OpcaoSelecionavel), findsNWidgets(3));
    expect(find.byType(OpcaoResultadoBar), findsNothing);
    // Morador: sem editar, excluir ou nova votação.
    expect(find.byKey(DetailAssembleia.chaveNovaVotacao), findsNothing);
    expect(find.byKey(CellVotacao.chaveExcluir(7)), findsNothing);
    expect(find.byTooltip('Editar assembleia'), findsNothing);
  });

  testWidgets('escolher não vota; "Votar" envia o payload exato e recarrega com o resultado', (tester) async {
    entrarComoMorador();
    servir([
      detalhe(),
      detalhe(meusVotos: ['13'], votacoes: [votacao(opcoes: ['12;Aprovo;1', '13;Reprovo;2', '14;Abstenção;1'])]),
    ]);
    await abrir(tester);

    expect(botao(tester).label, 'Votar');
    expect(botao(tester).onPressed, isNull, reason: 'sem opção escolhida');

    await tocar(tester, find.text('Reprovo'));
    expect(votosEnviados, isEmpty, reason: 'tocar na opção só marca');
    expect(tester.widgetList<OpcaoSelecionavel>(find.byType(OpcaoSelecionavel)).map((o) => o.selecionado),
        [false, true, false]);

    await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
    expect(votosEnviados, [
      {
        'id_condominio': '22',
        'voto': {'votacao_id': 7, 'opcao_id': 13},
      }
    ]);
    expect(chamadasDetalhe, 2, reason: 'recarrega depois de votar');

    expect(find.byType(OpcaoSelecionavel), findsNothing);
    final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
    expect(barras.map((b) => b.rotulo), ['Aprovo', 'Reprovo', 'Abstenção']);
    expect(barras.map((b) => b.meuVoto), [false, true, false]);
    expect(barras.map((b) => b.percentual), [25, 50, 25]);
    expect(find.text('Você já votou. Seu voto está destacado.'), findsOneWidget);
    expect(botao(tester).label, 'Alterar voto');
  });

  testWidgets('alterar voto: pré-marca o atual, confirma só com outra opção', (tester) async {
    entrarComoMorador();
    servir([detalhe(meusVotos: ['12'])]);
    await abrir(tester);

    await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
    expect(tester.widgetList<OpcaoSelecionavel>(find.byType(OpcaoSelecionavel)).map((o) => o.selecionado),
        [true, false, false]);
    expect(botao(tester).label, 'Confirmar voto');
    expect(botao(tester).onPressed, isNull);

    await tocar(tester, find.text('Abstenção'));
    await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
    expect(votosEnviados.single, {
      'id_condominio': '22',
      'voto': {'votacao_id': 7, 'opcao_id': 14},
    });

    // Cancelar volta ao resultado sem enviar.
    votosEnviados.clear();
    await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
    await tocar(tester, find.text('Cancelar'));
    expect(find.byType(OpcaoResultadoBar), findsNWidgets(3));
    expect(votosEnviados, isEmpty);
  });

  testWidgets('erro da API ao votar mostra a mensagem e mantém a escolha', (tester) async {
    entrarComoMorador();
    servir([detalhe()],
        respostaVoto: () => http.Response(jsonEncode({'message': 'Votação já foi finalizada'}), 400,
            headers: {'content-type': 'application/json; charset=utf-8'}));
    await abrir(tester);

    await tocar(tester, find.text('Aprovo'));
    await tocar(tester, find.byKey(CellVotacao.chaveVotar(7)));
    expect(find.text('Votação já foi finalizada'), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(tester.widgetList<OpcaoSelecionavel>(find.byType(OpcaoSelecionavel)).map((o) => o.selecionado),
        [true, false, false]);
  });

  testWidgets('encerrada e agendada: barras (somam 100 / zeradas), sem botão de votar', (tester) async {
    entrarComoMorador();
    servir([
      detalhe(meusVotos: ['14'], votacoes: [
        votacao(id: 7, status: 2),
        votacao(id: 8, status: 0, titulo: 'Troca do portão', opcoes: ['20;Sim;0', '21;Não;0']),
      ]),
    ]);
    await abrir(tester);

    expect(find.byType(CellVotacao), findsNWidgets(2));
    expect(find.byType(OpcaoSelecionavel), findsNothing);
    final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
    expect(barras.map((b) => b.percentual), [34, 33, 33, 0, 0]);
    expect(barras.map((b) => b.meuVoto), [false, false, true, false, false]);
    expect(find.text('Votação encerrada. Seu voto está destacado.'), findsOneWidget);
    expect(find.text('A votação abre em 01/10/2026.'), findsOneWidget);
    expect(find.text('Encerrada'), findsNothing); // finalizada: só o selo, sem chip de prazo
    expect(find.byKey(CellVotacao.chaveVotar(7)), findsNothing);
    expect(find.byKey(CellVotacao.chaveVotar(8)), findsNothing);
  });

  testWidgets('síndico: editar, nova votação e excluir votação (confirma e recarrega)', (tester) async {
    entrarComoSindico();
    servir([detalhe(), detalhe(votacoes: [])]);
    // showConfirmDialog (fora desta tarefa) estoura com a fonte de teste < ~400dp.
    await abrir(tester, largura: 600);

    expect(find.byTooltip('Editar assembleia'), findsOneWidget);
    expect(find.byTooltip('Finalizar assembleia'), findsOneWidget);
    expect(find.byKey(DetailAssembleia.chaveNovaVotacao), findsOneWidget);
    expect(find.text('Nova votação'), findsOneWidget);

    await tocar(tester, find.byKey(CellVotacao.chaveExcluir(7)));
    await tester.tap(find.text('Sim'));
    await tester.pumpAndSettle();
    expect(remocoes, [
      {'id': 7}
    ]);
    expect(chamadasDetalhe, 2);
    expect(find.byType(CellVotacao), findsNothing);
    expect(find.text('Nenhuma votação nesta assembleia.'), findsOneWidget);
  });

  testWidgets('anexos viram chips de download', (tester) async {
    entrarComoMorador();
    servir([detalhe(anexos: 'https://x/a.pdf;https://x/b.pdf;')]);
    await abrir(tester);
    expect(find.text('Anexo 1'), findsOneWidget);
    expect(find.text('Anexo 2'), findsOneWidget);
    expect(find.text('Anexo 3'), findsNothing);
  });

  testWidgets('320dp em tema escuro, textos longos, síndico: sem overflow (escolhendo e alterando)',
      (tester) async {
    entrarComoSindico();
    servir([
      detalhe(meusVotos: ['21'], votacoes: [
        votacao(
          titulo: 'Aprovação das contas do exercício de 2025 e da previsão orçamentária de 2026',
          opcoes: [
            '12;Aprovo integralmente as contas apresentadas pela administração;1',
            '13;Reprovo e peço auditoria externa independente;0',
          ],
        ),
        votacao(id: 8, opcoes: ['20;Sim;0', '21;Não;1']),
      ], anexos: 'https://x/a.pdf;https://x/b.pdf;https://x/c.pdf'),
    ]);
    await abrir(tester, largura: 320, tema: ThemeData(brightness: Brightness.dark));
    expect(tester.takeException(), isNull);

    await tocar(tester, find.byType(OpcaoSelecionavel).first);
    expect(tester.takeException(), isNull);
    await tocar(tester, find.byKey(CellVotacao.chaveVotar(8)));
    expect(find.text('Cancelar'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(SingleChildScrollView), const Offset(0, -3000));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
