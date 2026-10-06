import 'package:click/widgets/votacao/opcao_resultado_bar.dart';
import 'package:click/widgets/votacao/opcao_selecionavel.dart';
import 'package:click/widgets/votacao/votacao_card.dart';
import 'package:click/widgets/votacao/votacao_status_badge.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

Widget app(Widget child, {Brightness brightness = Brightness.light}) => MaterialApp(
      theme: ThemeData(brightness: brightness),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

/// Monta em largura de 320dp (celular pequeno) para pegar overflow.
Future<void> pump320(WidgetTester tester, Widget child, {Brightness brightness = Brightness.light}) async {
  tester.view.physicalSize = const Size(320, 640);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(app(child, brightness: brightness));
  await tester.pumpAndSettle();
}

final agora = DateTime(2026, 10, 6, 10);

void main() {
  group('VotacaoStatusBadge', () {
    testWidgets('mostra rótulo e ícone de cada status', (tester) async {
      await tester.pumpWidget(app(const Column(children: [
        VotacaoStatusBadge(status: 0),
        VotacaoStatusBadge(status: 1),
        VotacaoStatusBadge(status: 2),
      ])));
      // Primeiro teste do arquivo: deixa o GoogleFonts drenar seu timer de 0ms.
      await tester.pumpAndSettle();
      expect(find.text('Agendado'), findsOneWidget);
      expect(find.text('Em andamento'), findsOneWidget);
      expect(find.text('Finalizado'), findsOneWidget);
      expect(find.byIcon(PhosphorIcons.playCircle), findsOneWidget);
      expect(find.byIcon(PhosphorIcons.lockSimple), findsOneWidget);
    });

    testWidgets('semântica "Status: ..." e tema escuro', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(app(const VotacaoStatusBadge(status: 1), brightness: Brightness.dark));
      expect(find.bySemanticsLabel('Status: Em andamento'), findsOneWidget);
      handle.dispose();
    });
  });

  group('VotacaoCard', () {
    final item = {
      'id': 1,
      'titulo': 'Melhoria da Academia',
      'descricao': 'Qual equipamento comprar?',
      'data_inicio': '01/10/2026',
      'data_termino': '09/10/2026',
      'status': 1,
      'opcoes': ['1;Esteira;5', '2;Bicicleta;3'],
    };

    testWidgets('fromItem mostra título, selo, prazo e total de votos', (tester) async {
      await tester.pumpWidget(app(VotacaoCard.fromItem(item, agora: agora, onTap: () {})));
      expect(find.text('Melhoria da Academia'), findsOneWidget);
      expect(find.text('Em andamento'), findsOneWidget);
      expect(find.text('Encerra em 3 dias'), findsOneWidget);
      expect(find.text('8 votos'), findsOneWidget);
    });

    testWidgets('subtítulo opcional e "pergunta" quando não há título', (tester) async {
      await tester.pumpWidget(app(VotacaoCard.fromItem(
        {'pergunta': 'Pintar a fachada?', 'status': 2, 'opcoes': []},
        subtitulo: 'Assembleia de outubro',
      )));
      expect(find.text('Pintar a fachada?'), findsOneWidget);
      expect(find.text('Assembleia de outubro'), findsOneWidget);
      expect(find.text('Encerrada'), findsOneWidget);
      expect(find.text('0 votos'), findsOneWidget);
    });

    testWidgets('sem totalVotos não mostra contagem; sem prazo não mostra chip', (tester) async {
      await tester.pumpWidget(app(const VotacaoCard(titulo: 'X', status: 1, dataTermino: '')));
      expect(find.textContaining('voto'), findsNothing);
      expect(find.textContaining('Encerra'), findsNothing);
    });

    testWidgets('toque dispara onTap, alvo ≥ 48dp e semântica com ação de toque', (tester) async {
      final handle = tester.ensureSemantics();
      var toques = 0;
      await tester.pumpWidget(app(VotacaoCard.fromItem(item, agora: agora, onTap: () => toques++)));
      await tester.tap(find.byType(VotacaoCard));
      await tester.pump();
      expect(toques, 1);
      expect(tester.getSize(find.byType(VotacaoCard)).height, greaterThanOrEqualTo(48));

      final node = tester.getSemantics(find.byType(VotacaoCard));
      expect(node.label, contains('Melhoria da Academia'));
      expect(node.label, contains('Em andamento'));
      expect(node.label, contains('Encerra em 3 dias'));
      expect(node.label, contains('8 votos'));
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);

      // Toque duplo do TalkBack/VoiceOver chega como SemanticsAction.tap.
      tester.semantics.tap(find.semantics.byLabel(node.label));
      await tester.pump();
      expect(toques, 2);
      handle.dispose();
    });

    testWidgets('320dp com título longo, escuro, sem overflow', (tester) async {
      await pump320(
        tester,
        VotacaoCard.fromItem({
          ...item,
          'titulo': 'Aprovação da reforma completa do salão de festas, da churrasqueira e da piscina adulto',
        }, subtitulo: 'Uma descrição também bem comprida para ver se quebra', agora: agora, onTap: () {}),
        brightness: Brightness.dark,
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('OpcaoResultadoBar', () {
    testWidgets('mostra rótulo, percentual e votos; anima a barra até o valor', (tester) async {
      await tester.pumpWidget(app(const OpcaoResultadoBar(rotulo: 'Esteira', votos: 5, percentual: 63)));
      expect(find.text('Esteira'), findsOneWidget);
      expect(find.text('63%'), findsOneWidget);
      expect(find.text('5 votos'), findsOneWidget);
      expect(find.text('Seu voto'), findsNothing);

      final inicio = tester.widget<FractionallySizedBox>(find.byKey(OpcaoResultadoBar.chaveBarra)).widthFactor!;
      await tester.pumpAndSettle();
      final fim = tester.widget<FractionallySizedBox>(find.byKey(OpcaoResultadoBar.chaveBarra)).widthFactor!;
      expect(inicio, lessThan(fim));
      expect(fim, closeTo(0.63, 0.001));
    });

    testWidgets('destaca o voto do usuário', (tester) async {
      await tester.pumpWidget(app(const OpcaoResultadoBar(rotulo: 'Esteira', votos: 1, percentual: 100, meuVoto: true)));
      await tester.pumpAndSettle();
      expect(find.text('Seu voto'), findsOneWidget);
      expect(find.text('1 voto'), findsOneWidget);
    });

    testWidgets('semântica com rótulo completo', (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(app(const OpcaoResultadoBar(rotulo: 'Esteira', votos: 5, percentual: 63, meuVoto: true)));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Esteira: 63%, 5 votos, seu voto'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('0% e 320dp escuro com rótulo longo sem overflow', (tester) async {
      await pump320(
        tester,
        const Column(children: [
          OpcaoResultadoBar(rotulo: 'Nenhum', votos: 0, percentual: 0),
          OpcaoResultadoBar(
            rotulo: 'Uma opção com um texto muito longo para caber em uma linha só no celular pequeno',
            votos: 1234,
            percentual: 100,
            meuVoto: true,
          ),
        ]),
        brightness: Brightness.dark,
      );
      expect(tester.takeException(), isNull);
      expect(find.text('0%'), findsOneWidget);
    });
  });

  group('OpcaoSelecionavel', () {
    testWidgets('toque chama onTap; selecionado mostra check', (tester) async {
      var toques = 0;
      await tester.pumpWidget(app(OpcaoSelecionavel(rotulo: 'Esteira', selecionado: false, onTap: () => toques++)));
      expect(find.byIcon(PhosphorIcons.checkCircleFill), findsNothing);
      await tester.tap(find.text('Esteira'));
      await tester.pump();
      expect(toques, 1);
      expect(tester.getSize(find.byType(OpcaoSelecionavel)).height, greaterThanOrEqualTo(48));

      await tester.pumpWidget(app(OpcaoSelecionavel(rotulo: 'Esteira', selecionado: true, onTap: () {})));
      await tester.pumpAndSettle();
      expect(find.byIcon(PhosphorIcons.checkCircleFill), findsOneWidget);
    });

    testWidgets('desabilitado não dispara', (tester) async {
      var toques = 0;
      await tester.pumpWidget(app(OpcaoSelecionavel(
        rotulo: 'Esteira',
        selecionado: false,
        habilitado: false,
        onTap: () => toques++,
      )));
      await tester.tap(find.text('Esteira'), warnIfMissed: false);
      await tester.pump();
      expect(toques, 0);
    });

    testWidgets('semântica de rádio: rótulo, marcado, grupo exclusivo e ação de toque', (tester) async {
      final handle = tester.ensureSemantics();
      var toques = 0;
      await tester.pumpWidget(app(OpcaoSelecionavel(rotulo: 'Esteira', selecionado: true, onTap: () => toques++)));
      final node = tester.getSemantics(find.byType(OpcaoSelecionavel));
      expect(
        node,
        isSemantics(
          label: 'Esteira',
          isChecked: true,
          hasCheckedState: true,
          isInMutuallyExclusiveGroup: true,
          isEnabled: true,
          hasEnabledState: true,
          hasTapAction: true,
        ),
      );
      tester.semantics.tap(find.semantics.byLabel('Esteira'));
      await tester.pump();
      expect(toques, 1);
      handle.dispose();
    });

    testWidgets('320dp escuro com texto longo sem overflow', (tester) async {
      await pump320(
        tester,
        OpcaoSelecionavel(
          rotulo: 'Uma opção com um texto muito longo para caber em uma linha só no celular pequeno',
          selecionado: true,
          onTap: () {},
        ),
        brightness: Brightness.dark,
      );
      expect(tester.takeException(), isNull);
    });
  });
}
