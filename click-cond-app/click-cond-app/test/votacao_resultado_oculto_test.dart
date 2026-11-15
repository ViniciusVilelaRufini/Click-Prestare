import 'dart:convert';

import 'package:click/pages/shared/assembleias/detail_assembleia.dart';
import 'package:click/pages/shared/enquetes/detail_enquete.dart';
import 'package:click/pages/singleton.dart';
import 'package:click/utils/api_client.dart';
import 'package:click/utils/local_storage.dart';
import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/votacao_card.dart';
import 'package:click/widgets/votacao/votacao_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

// Rodada 5 (assembleia robusta): enquanto a votação está aberta ou agendada a
// API zera os votos em `opcoes` e manda `resultado_oculto: true` e a
// `participacao` (quórum). O app não mostra barra nem número e mostra a
// participação. API antiga (sem os campos) = como antes.

Map<String, dynamic> votacao({
  int id = 7,
  int status = 1,
  bool? oculto,
  Map<String, dynamic>? participacao,
  List<String> opcoes = const ['12;Aprovo;0', '13;Reprovo;0'],
}) =>
    {
      'id': id,
      'titulo': 'Aprovação das contas',
      'descricao': '',
      'data_inicio': '01/10/2026',
      'data_termino': '30/10/2026',
      'status': status,
      'opcoes': opcoes,
      if (oculto != null) 'resultado_oculto': oculto,
      if (participacao != null) 'participacao': participacao,
    };

void main() {
  group('helpers', () {
    test('resultadoOculto: só com o campo verdadeiro (API antiga = falso)', () {
      expect(resultadoOculto({'resultado_oculto': true}), isTrue);
      expect(resultadoOculto({'resultado_oculto': 1}), isTrue);
      expect(resultadoOculto({'resultado_oculto': 'true'}), isTrue);
      expect(resultadoOculto({'resultado_oculto': false}), isFalse);
      expect(resultadoOculto({'resultado_oculto': 0}), isFalse);
      expect(resultadoOculto(<String, dynamic>{}), isFalse);
      expect(resultadoOculto(null), isFalse);
      expect(resultadoOculto('x'), isFalse);
    });

    test('participacaoDaVotacao: lê o quórum; ausente ou sem total → nulo', () {
      final p = participacaoDaVotacao({
        'participacao': {'unidades_votaram': 3, 'unidades_total': 40}
      })!;
      expect(p.votaram, 3);
      expect(p.total, 40);
      expect(participacaoDaVotacao({
        'participacao': {'unidades_votaram': '2', 'unidades_total': '10'}
      })!.votaram, 2);
      expect(participacaoDaVotacao(<String, dynamic>{}), isNull);
      expect(participacaoDaVotacao({'participacao': 'x'}), isNull);
      expect(participacaoDaVotacao({
        'participacao': {'unidades_votaram': 0, 'unidades_total': 0}
      }), isNull);
      expect(participacaoDaVotacao(null), isNull);
    });

    test('participacaoLabel: singular e plural', () {
      expect(participacaoLabel(const Participacao(votaram: 0, total: 40)), '0 de 40 unidades votaram');
      expect(participacaoLabel(const Participacao(votaram: 1, total: 40)), '1 de 40 unidades votou');
      expect(participacaoLabel(const Participacao(votaram: 12, total: 40)), '12 de 40 unidades votaram');
    });

    test('resumoVotosLabel: participação quando vem; senão votos; oculto sem participação → nulo', () {
      expect(
          resumoVotosLabel(votacao(oculto: true, participacao: {'unidades_votaram': 3, 'unidades_total': 40})),
          '3 de 40 unidades votaram');
      expect(
          resumoVotosLabel(votacao(
              status: 2,
              oculto: false,
              participacao: {'unidades_votaram': 2, 'unidades_total': 40},
              opcoes: ['12;Aprovo;1', '13;Reprovo;1'])),
          '2 de 40 unidades votaram');
      expect(resumoVotosLabel(votacao(oculto: true)), isNull);
      // API antiga: contagem de votos, como antes.
      expect(resumoVotosLabel(votacao(opcoes: ['12;Aprovo;2', '13;Reprovo;1'])), '3 votos');
    });

    test('texto do resultado oculto', () {
      expect(textoResultadoOculto, 'Resultado disponível ao encerrar');
    });
  });

  group('OpcaoResultadoBar oculto', () {
    Future<void> montar(WidgetTester tester, Widget w) async {
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: w)));
      // GoogleFonts deixa um timer de 0ms.
      await tester.pumpAndSettle();
    }

    testWidgets('sem percentual, barra nem contagem; o "Seu voto" continua', (tester) async {
      await montar(
          tester,
          const OpcaoResultadoBar(
              rotulo: 'Aprovo', votos: 0, percentual: 0, meuVoto: true, ocultarResultado: true));
      expect(find.text('Aprovo'), findsOneWidget);
      expect(find.text('Seu voto'), findsOneWidget);
      expect(find.text('0%'), findsNothing);
      expect(find.text('0 votos'), findsNothing);
      expect(find.byKey(OpcaoResultadoBar.chaveBarra), findsNothing);
    });

    testWidgets('padrão continua mostrando percentual e votos', (tester) async {
      await montar(tester, const OpcaoResultadoBar(rotulo: 'Aprovo', votos: 2, percentual: 50));
      expect(find.text('50%'), findsOneWidget);
      expect(find.text('2 votos'), findsOneWidget);
    });
  });

  group('VotacaoCard', () {
    testWidgets('oculto: mostra a participação, não "0 votos"', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: VotacaoCard.fromItem(
              votacao(oculto: true, participacao: {'unidades_votaram': 3, 'unidades_total': 40})),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('3 de 40 unidades votaram'), findsOneWidget);
      expect(find.text('0 votos'), findsNothing);
    });

    testWidgets('API antiga: total de votos como antes', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: VotacaoCard.fromItem(votacao(opcoes: ['12;Aprovo;2', '13;Reprovo;1']))),
      ));
      await tester.pumpAndSettle();
      expect(find.text('3 votos'), findsOneWidget);
    });
  });

  group('telas', () {
    TestWidgetsFlutterBinding.ensureInitialized();
    const json = {'content-type': 'application/json; charset=utf-8'};

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
      tester.view.physicalSize = const Size(400 * 3, 900 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(home: tela));
      await tester.pumpAndSettle();
    }

    testWidgets('assembleia: já votou com resultado oculto → só nomes, voto marcado, participação',
        (tester) async {
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/get')) {
          return http.Response(
              jsonEncode({
                'assembleia': {'id': 5, 'titulo': 'AGO', 'data': '11/10/2026', 'hora': '19:30'},
                'votacoes': [
                  votacao(oculto: true, participacao: {'unidades_votaram': 3, 'unidades_total': 40})
                ],
                'meusVotos': ['13'],
              }),
              200,
              headers: json);
        }
        return http.Response('', 404);
      });
      await abrir(tester, const DetailAssembleia(id: 5));

      final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
      expect(barras.map((b) => b.ocultarResultado), [true, true]);
      expect(barras.map((b) => b.meuVoto), [false, true]);
      expect(find.text('0%'), findsNothing);
      expect(find.text('3 de 40 unidades votaram'), findsOneWidget);
      expect(find.text(textoResultadoOculto), findsOneWidget);
      expect(find.text('0 votos'), findsNothing);
    });

    testWidgets('enquete: já votou com resultado oculto → sem números, título "Opções"', (tester) async {
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/votacoes/enquetes/get')) {
          return http.Response(
              jsonEncode({
                'votacao': votacao(oculto: true, participacao: {'unidades_votaram': 1, 'unidades_total': 10}),
                'meuVoto': ['12'],
              }),
              200,
              headers: json);
        }
        return http.Response('', 404);
      });
      await abrir(tester, const DetailEnquete(id: 7));

      final barras = tester.widgetList<OpcaoResultadoBar>(find.byType(OpcaoResultadoBar)).toList();
      expect(barras.map((b) => b.ocultarResultado), [true, true]);
      expect(barras.map((b) => b.meuVoto), [true, false]);
      expect(find.text('RESULTADO'), findsNothing);
      expect(find.text('OPÇÕES'), findsOneWidget);
      expect(find.text('1 de 10 unidades votou'), findsOneWidget);
      expect(find.text(textoResultadoOculto), findsOneWidget);
    });

    testWidgets('enquete encerrada (resultado_oculto falso): barras com números como antes', (tester) async {
      ApiClient.client = MockClient((request) async {
        if (request.url.path.endsWith('/assembleias/votacoes/enquetes/get')) {
          return http.Response(
              jsonEncode({
                'votacao': votacao(
                    status: 2,
                    oculto: false,
                    participacao: {'unidades_votaram': 2, 'unidades_total': 10},
                    opcoes: ['12;Aprovo;1', '13;Reprovo;1']),
                'meuVoto': ['12'],
              }),
              200,
              headers: json);
        }
        return http.Response('', 404);
      });
      await abrir(tester, const DetailEnquete(id: 7));

      expect(find.text('50%'), findsNWidgets(2));
      expect(find.text(textoResultadoOculto), findsNothing);
      expect(find.text('2 de 10 unidades votaram'), findsOneWidget);
    });
  });
}
