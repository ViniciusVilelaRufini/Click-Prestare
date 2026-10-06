import 'dart:convert';

import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/app/app_button.dart';
import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> enquete({
  int status = 1,
  List<String> meuVoto = const [],
  List<String> opcoes = const ['12;Azul;1', '13;Branco;1', '14;Verde;1'],
  String titulo = 'Cor da fachada',
}) =>
    {
      'votacao': {
        'id': 7,
        'titulo': titulo,
        'descricao': 'A pintura começa em novembro.',
        'data_inicio': '01/10/2026',
        'data_termino': '30/10/2026',
        'status': status,
        'opcoes': opcoes,
      },
      'meuVoto': meuVoto,
    };

void entrarComoMorador() => storageMorador({'token': 't', 'user': {'id': 1, 'nome': 'Ana'}});
void entrarComoSindico() => storageLogin({'token': 't', 'user': {'id': 2, 'name': 'Sid'}});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late int chamadasDetalhe;
  late List<Map<String, dynamic>> votosEnviados;
  late List<Map<String, dynamic>> finalizacoes;

  /// [respostas] é servida em ordem a cada GET do detalhe (a última se repete).
  void servir(List<Map<String, dynamic>> respostas) {
    chamadasDetalhe = 0;
    votosEnviados = [];
    finalizacoes = [];
    ApiClient.client = MockClient((request) async {
      final path = request.url.path;
      if (path.endsWith('/assembleias/votacoes/enquetes/get')) {
        expect(request.url.queryParameters['id'], '7');
        final r = respostas[chamadasDetalhe.clamp(0, respostas.length - 1)];
        chamadasDetalhe++;
        return http.Response(jsonEncode(r), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      if (path.endsWith('/assembleias/votacoes/voto/insert')) {
        votosEnviados.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response('{}', 200, headers: {'content-type': 'application/json'});
      }
      if (path.endsWith('/assembleias/votacoes/finish')) {
        finalizacoes.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response('{}', 200, headers: {'content-type': 'application/json'});
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
    tester.view.physicalSize = Size(largura * 3, 800 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(theme: tema, home: const DetailEnquete(id: 7)));
    await tester.pumpAndSettle();
  }

  AppButton botaoVotar(WidgetTester tester) => tester.widget<AppButton>(find.byKey(DetailEnquete.chaveBotaoVotar));

  Future<void> tocar(WidgetTester tester, Finder f) async {
    await tester.ensureVisible(f);
    await tester.pumpAndSettle();
    await tester.tap(f);
    await tester.pumpAndSettle();
  }

  testWidgets('em andamento e sem voto: escolhe a opção, vota com o payload exato e passa a ver o resultado',
      (tester) async {
    entrarComoMorador();
    servir([
      enquete(),
      enquete(meuVoto: ['13'], opcoes: ['12;Azul;1', '13;Branco;2', '14;Verde;1']),
    ]);
    await abrir(tester);

    expect(find.text('Votação aberta'), findsOneWidget);
    expect(find.byType(OpcaoSelecionavel), findsNWidgets(3));
    expect(find.byType(OpcaoResultadoBar), findsNothing);
    expect(botaoVotar(tester).label, 'Votar');
    expect(botaoVotar(tester).onPressed, isNull, reason: 'sem opção escolhida o botão fica desabilitado');

    await tocar(tester, find.text('Branco'));
    final sel = tester.widgetList<OpcaoSelecionavel>(find.byType(OpcaoSelecionavel)).toList();
    expect(sel.map((o) => o.selecionado), [false, true, false]);
    expect(botaoVotar(tester).onPressed, isNotNull);

    await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));

    expect(votosEnviados, [
      {
        'id_condominio': '22',
        'voto': {'votacao_id': 7, 'opcao_id': 13},
      }
    ]);
    expect(chamadasDetalhe, 2, reason: 'recarrega depois de votar');
    expect(find.text('Você já votou'), findsOneWidget);
    expect(find.byType(OpcaoSelecionavel), findsNothing);
    final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
    expect(barras.map((b) => b.rotulo), ['Azul', 'Branco', 'Verde']);
    expect(barras.map((b) => b.meuVoto), [false, true, false]);
    expect(barras.map((b) => b.percentual), [25, 50, 25]);
    expect(botaoVotar(tester).label, 'Alterar voto');
  });

  testWidgets('quem já votou pode alterar o voto: confirma só com outra opção', (tester) async {
    entrarComoMorador();
    servir([enquete(meuVoto: ['12'])]);
    await abrir(tester);

    await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
    expect(find.text('Alterando seu voto'), findsOneWidget);
    final sel = tester.widgetList<OpcaoSelecionavel>(find.byType(OpcaoSelecionavel)).toList();
    expect(sel.map((o) => o.selecionado), [true, false, false]);
    expect(botaoVotar(tester).label, 'Confirmar voto');
    expect(botaoVotar(tester).onPressed, isNull, reason: 'mesma opção do voto atual');

    await tocar(tester, find.text('Verde'));
    expect(botaoVotar(tester).onPressed, isNotNull);
    await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
    expect(votosEnviados.single, {
      'id_condominio': '22',
      'voto': {'votacao_id': 7, 'opcao_id': 14},
    });
  });

  testWidgets('cancelar a alteração volta ao resultado sem enviar nada', (tester) async {
    entrarComoMorador();
    servir([enquete(meuVoto: ['12'])]);
    await abrir(tester);

    await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
    await tocar(tester, find.text('Cancelar'));
    expect(find.text('Você já votou'), findsOneWidget);
    expect(find.byType(OpcaoResultadoBar), findsNWidgets(3));
    expect(votosEnviados, isEmpty);
  });

  testWidgets('encerrada: resultado em barras que somam 100, voto destacado, sem rodapé nem finalizar',
      (tester) async {
    entrarComoSindico();
    servir([enquete(status: 2, meuVoto: ['14'])]);
    await abrir(tester);

    expect(find.text('Enquete encerrada'), findsOneWidget);
    expect(find.text('Encerrada'), findsNothing); // sem chip de prazo: o selo já diz "Finalizado"
    expect(find.text('3 votos'), findsOneWidget); // total no cabeçalho
    final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
    expect(barras.map((b) => b.percentual), [34, 33, 33]);
    expect(barras.fold<int>(0, (s, b) => s + b.percentual), 100);
    expect(barras.map((b) => b.meuVoto), [false, false, true]);
    expect(find.byType(OpcaoSelecionavel), findsNothing);
    expect(find.byKey(DetailEnquete.chaveBotaoVotar), findsNothing);
    expect(find.byKey(DetailEnquete.chaveBotaoFinalizar), findsNothing);
  });

  testWidgets('agendada: avisa que não começou e não deixa votar', (tester) async {
    entrarComoSindico();
    servir([enquete(status: 0, opcoes: ['12;Azul;0', '13;Branco;0'])]);
    await abrir(tester);

    expect(find.text('Enquete ainda não começou'), findsOneWidget);
    expect(find.text('A votação abre em 01/10/2026.'), findsOneWidget);
    final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
    expect(barras.map((b) => b.percentual), [0, 0]);
    expect(find.byKey(DetailEnquete.chaveBotaoVotar), findsNothing);
    expect(find.byKey(DetailEnquete.chaveBotaoFinalizar), findsNothing);
  });

  testWidgets('morador não vê o botão de finalizar', (tester) async {
    entrarComoMorador();
    servir([enquete()]);
    await abrir(tester);
    expect(find.byKey(DetailEnquete.chaveBotaoFinalizar), findsNothing);
  });

  testWidgets('síndico finaliza a enquete em andamento após confirmar', (tester) async {
    entrarComoSindico();
    servir([enquete(), enquete(status: 2)]);
    // O diálogo de confirmação (showConfirmDialog, fora desta tarefa) estoura
    // a linha do título com a fonte de teste (Ahem) abaixo de ~400dp.
    await abrir(tester, largura: 600);

    final finalizar = find.byKey(DetailEnquete.chaveBotaoFinalizar);
    expect(finalizar, findsOneWidget);
    expect(find.text('Finalizar votação'), findsOneWidget);

    // "Não" no diálogo não chama a API.
    await tocar(tester, finalizar);
    expect(find.text('Tem certeza de que deseja finalizar a votação antes da data de término planejada?'),
        findsOneWidget);
    await tester.tap(find.text('Não'));
    await tester.pumpAndSettle();
    expect(finalizacoes, isEmpty);

    await tocar(tester, finalizar);
    await tester.tap(find.text('Sim'));
    await tester.pumpAndSettle();
    expect(finalizacoes, [
      {'id': '7'}
    ]);
    expect(chamadasDetalhe, 2);
    expect(find.text('Enquete encerrada'), findsOneWidget);
  });

  testWidgets('erro da API ao votar mostra a mensagem e mantém a escolha', (tester) async {
    entrarComoMorador();
    ApiClient.client = MockClient((request) async {
      if (request.url.path.endsWith('/assembleias/votacoes/enquetes/get')) {
        return http.Response(jsonEncode(enquete()), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      }
      if (request.url.path.endsWith('/assembleias/votacoes/voto/insert')) {
        return http.Response(jsonEncode({'message': 'Votação já foi finalizada'}), 400,
            headers: {'content-type': 'application/json; charset=utf-8'});
      }
      return http.Response('', 404);
    });
    await abrir(tester);

    await tocar(tester, find.text('Azul'));
    await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
    expect(find.text('Votação já foi finalizada'), findsOneWidget);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    final sel = tester.widgetList<OpcaoSelecionavel>(find.byType(OpcaoSelecionavel)).toList();
    expect(sel.map((o) => o.selecionado), [true, false, false]);
  });

  testWidgets('320dp em tema escuro, título e opções longas: sem overflow nos três estados', (tester) async {
    entrarComoSindico();
    const longas = [
      '12;Pintar toda a fachada de azul-claro com detalhes em branco gelo;1',
      '13;Manter a cor atual e apenas lavar as paredes externas;0',
    ];
    final titulo = 'Escolha da nova cor da fachada principal e das áreas comuns do condomínio';
    servir([enquete(titulo: titulo, opcoes: longas)]);
    await abrir(tester, largura: 320, tema: ThemeData(brightness: Brightness.dark));
    expect(tester.takeException(), isNull);
    await tocar(tester, find.byType(OpcaoSelecionavel).first);
    expect(tester.takeException(), isNull);
    await tester.drag(find.byType(SingleChildScrollView), const Offset(0, -2000));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('320dp em tema escuro, já votou (modo alterar): sem overflow', (tester) async {
    entrarComoMorador();
    servir([enquete(meuVoto: ['12'])]);
    await abrir(tester, largura: 320, tema: ThemeData(brightness: Brightness.dark));
    await tocar(tester, find.byKey(DetailEnquete.chaveBotaoVotar));
    expect(tester.takeException(), isNull);
    expect(find.text('Cancelar'), findsOneWidget);
  });
}
