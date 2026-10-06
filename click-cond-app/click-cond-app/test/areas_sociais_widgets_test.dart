import 'package:click/pages/shared/areas%20sociais/widgets/convidados_stepper.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/disponibilidade_calendario.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/horario_card.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/minha_reserva_card.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/reserva_status_badge.dart';
import 'package:click/pages/shared/areas%20sociais/widgets/resumo_reserva.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

Widget app(Widget child, {Brightness brightness = Brightness.light}) => MaterialApp(
      theme: ThemeData(brightness: brightness),
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

void main() {
  group('ReservaStatusBadge', () {
    testWidgets('mostra rótulo e ícone do status', (tester) async {
      await tester.pumpWidget(app(const ReservaStatusBadge(status: 'aprovado')));
      expect(find.text('Aprovada'), findsOneWidget);
      expect(find.byIcon(PhosphorIcons.checkCircle), findsOneWidget);
    });

    testWidgets('status desconhecido mostra o texto original', (tester) async {
      await tester.pumpWidget(app(const ReservaStatusBadge(status: 'em análise')));
      expect(find.text('em análise'), findsOneWidget);
    });

    testWidgets('renderiza no tema escuro', (tester) async {
      await tester.pumpWidget(app(const ReservaStatusBadge(status: 'recusado'), brightness: Brightness.dark));
      expect(find.text('Recusada'), findsOneWidget);
    });
  });

  group('MinhaReservaCard', () {
    final reserva = {
      'id': 9,
      'bloco': 'A',
      'apto': '101',
      'data': '11/10/2026',
      'horaDe': '10:00',
      'horaAte': '16:00',
      'status': 'pendente',
      'convidados': 12,
    };

    testWidgets('mostra data, horário, duração, convidados e selo', (tester) async {
      await tester.pumpWidget(app(MinhaReservaCard(reserva: reserva)));
      expect(find.text('11'), findsOneWidget);
      expect(find.text('OUT'), findsOneWidget);
      expect(find.text('DOM'), findsOneWidget);
      expect(find.text('10:00 – 16:00'), findsOneWidget);
      expect(find.text('6 h'), findsOneWidget);
      expect(find.text('12 convidados'), findsOneWidget);
      expect(find.text('Pendente'), findsOneWidget);
    });

    testWidgets('sem callback não mostra "Editar"; sem mostrarApto não mostra apto', (tester) async {
      await tester.pumpWidget(app(MinhaReservaCard(reserva: reserva)));
      expect(find.text('Editar'), findsNothing);
      expect(find.text('Bloco A · Apto 101'), findsNothing);
    });

    testWidgets('com callback mostra "Editar" e dispara ao tocar', (tester) async {
      var toques = 0;
      await tester.pumpWidget(app(MinhaReservaCard(reserva: reserva, onEditar: () => toques++)));
      await tester.tap(find.text('Editar'));
      await tester.pump();
      expect(toques, 1);
      expect(tester.getSize(find.byKey(MinhaReservaCard.chaveEditar)).height, greaterThanOrEqualTo(48));
    });

    testWidgets('mostrarApto exibe bloco e apto', (tester) async {
      await tester.pumpWidget(app(MinhaReservaCard(reserva: reserva, mostrarApto: true)));
      expect(find.text('Bloco A · Apto 101'), findsOneWidget);
    });

    testWidgets('sem convidados não mostra a linha de convidados; data inválida não quebra', (tester) async {
      await tester.pumpWidget(app(MinhaReservaCard(reserva: {
        ...reserva,
        'convidados': null,
        'data': '',
        'status': 'recusado',
      })));
      expect(find.textContaining('convidado'), findsNothing);
      expect(find.text('Recusada'), findsOneWidget);
    });
  });

  group('HorarioCard', () {
    testWidgets('mostra faixa e duração e dispara onTap', (tester) async {
      var toques = 0;
      await tester.pumpWidget(app(HorarioCard(de: '10:00', ate: '16:00', onTap: () => toques++)));
      expect(find.text('10:00 – 16:00'), findsOneWidget);
      expect(find.text('6 h'), findsOneWidget);
      expect(find.byIcon(PhosphorIcons.checkCircleFill), findsNothing);
      await tester.tap(find.byType(HorarioCard));
      expect(toques, 1);
      expect(tester.getSize(find.byType(HorarioCard)).height, greaterThanOrEqualTo(48));
    });

    testWidgets('selecionado mostra check', (tester) async {
      await tester.pumpWidget(app(HorarioCard(de: '10:00', ate: '11:30', selecionado: true, onTap: () {})));
      expect(find.byIcon(PhosphorIcons.checkCircleFill), findsOneWidget);
      expect(find.text('1 h 30'), findsOneWidget);
    });

    testWidgets('leitor de tela: botão com ação de toque, rótulo e estado selecionado', (tester) async {
      final semantica = tester.ensureSemantics();
      var toques = 0;
      await tester.pumpWidget(app(HorarioCard(de: '10:00', ate: '16:00', selecionado: true, onTap: () => toques++)));

      final no = tester.getSemantics(find.byType(HorarioCard));
      expect(
        no,
        isSemantics(
          label: '10:00 – 16:00, duração 6 h',
          isButton: true,
          isSelected: true,
          hasTapAction: true,
        ),
      );

      // Toque duplo do TalkBack/VoiceOver chega como SemanticsAction.tap.
      tester.semantics.tap(find.semantics.byLabel('10:00 – 16:00, duração 6 h'));
      await tester.pump();
      expect(toques, 1);
      semantica.dispose();
    });
  });

  group('ConvidadosStepper', () {
    IconButton botao(WidgetTester tester, Key key) => tester.widget<IconButton>(find.byKey(key));

    testWidgets('vazio mostra "Opcional"; − desabilitado; + vai para 1', (tester) async {
      int? recebido = -1;
      await tester.pumpWidget(app(ConvidadosStepper(valor: null, capacidade: 10, onChanged: (v) => recebido = v)));
      expect(find.text('Opcional'), findsOneWidget);
      expect(botao(tester, ConvidadosStepper.chaveMenos).onPressed, isNull);
      await tester.tap(find.byKey(ConvidadosStepper.chaveMais));
      expect(recebido, 1);
    });

    testWidgets('− no valor 1 volta para nulo', (tester) async {
      int? recebido = -1;
      await tester.pumpWidget(app(ConvidadosStepper(valor: 1, capacidade: 10, onChanged: (v) => recebido = v)));
      await tester.tap(find.byKey(ConvidadosStepper.chaveMenos));
      expect(recebido, isNull);
    });

    testWidgets('− acima de 1 decrementa', (tester) async {
      int? recebido;
      await tester.pumpWidget(app(ConvidadosStepper(valor: 4, capacidade: 10, onChanged: (v) => recebido = v)));
      await tester.tap(find.byKey(ConvidadosStepper.chaveMenos));
      expect(recebido, 3);
    });

    testWidgets('+ desabilitado no limite da capacidade e mostra "de N"', (tester) async {
      await tester.pumpWidget(app(ConvidadosStepper(valor: 5, capacidade: 5, onChanged: (_) {})));
      expect(find.text('5'), findsOneWidget);
      expect(find.text('de 5'), findsOneWidget);
      expect(botao(tester, ConvidadosStepper.chaveMais).onPressed, isNull);
      expect(botao(tester, ConvidadosStepper.chaveMenos).onPressed, isNotNull);
    });

    testWidgets('sem capacidade não tem limite nem "de N"', (tester) async {
      int? recebido;
      await tester.pumpWidget(app(ConvidadosStepper(valor: 30, capacidade: 0, onChanged: (v) => recebido = v)));
      expect(find.textContaining('de '), findsNothing);
      await tester.tap(find.byKey(ConvidadosStepper.chaveMais));
      expect(recebido, 31);
    });

    testWidgets('desabilitado bloqueia os dois botões', (tester) async {
      await tester.pumpWidget(app(ConvidadosStepper(valor: 3, capacidade: 10, habilitado: false, onChanged: (_) {})));
      expect(botao(tester, ConvidadosStepper.chaveMais).onPressed, isNull);
      expect(botao(tester, ConvidadosStepper.chaveMenos).onPressed, isNull);
    });

    testWidgets('botões têm alvo de toque de 48dp', (tester) async {
      await tester.pumpWidget(app(ConvidadosStepper(valor: 3, capacidade: 10, onChanged: (_) {})));
      final s = tester.getSize(find.byKey(ConvidadosStepper.chaveMais));
      expect(s.width, greaterThanOrEqualTo(48));
      expect(s.height, greaterThanOrEqualTo(48));
    });
  });

  group('ResumoReserva', () {
    testWidgets('mostra área, data por extenso, horário, convidados e apto', (tester) async {
      await tester.pumpWidget(app(const ResumoReserva(
        area: 'Salão de festas',
        data: '11/10/2026',
        horario: '10:00 - 16:00',
        convidados: 12,
        bloco: 'A',
        apto: '101',
      )));
      expect(find.text('Resumo da reserva'), findsOneWidget);
      expect(find.text('Salão de festas'), findsOneWidget);
      expect(find.text('Domingo, 11 de outubro de 2026'), findsOneWidget);
      expect(find.text('10:00 – 16:00 · 6 h'), findsOneWidget);
      expect(find.text('12 convidados'), findsOneWidget);
      expect(find.text('Bloco A · Apto 101'), findsOneWidget);
    });

    testWidgets('sem apto e sem convidados', (tester) async {
      await tester.pumpWidget(app(const ResumoReserva(
        area: 'Churrasqueira',
        data: '11/10/2026',
        horario: '10:00 - 16:00',
      )));
      expect(find.text('Sem convidados informados'), findsOneWidget);
      expect(find.textContaining('Apto'), findsNothing);
    });
  });

  group('DisponibilidadeCalendario', () {
    final dias = {DateTime(2026, 10, 10), DateTime(2026, 10, 12), DateTime(2026, 10, 20)};

    testWidgets('dia indisponível não dispara; disponível dispara com a data sem hora', (tester) async {
      final recebidos = <DateTime>[];
      await tester.pumpWidget(app(DisponibilidadeCalendario(
        diasDisponiveis: dias,
        onSelecionar: recebidos.add,
      )));
      await tester.pumpAndSettle();

      expect(find.text('Outubro de 2026'), findsOneWidget);

      await tester.tap(find.text('11'));
      await tester.pump();
      expect(recebidos, isEmpty);

      await tester.tap(find.text('5')); // antes do primeiro dia disponível
      await tester.pump();
      expect(recebidos, isEmpty);

      await tester.tap(find.text('12'));
      await tester.pump();
      expect(recebidos, [DateTime(2026, 10, 12)]);
    });

    testWidgets('aceita datas com hora no conjunto', (tester) async {
      final recebidos = <DateTime>[];
      await tester.pumpWidget(app(DisponibilidadeCalendario(
        diasDisponiveis: {DateTime(2026, 10, 12, 15, 30)},
        onSelecionar: recebidos.add,
      )));
      await tester.pumpAndSettle();
      await tester.tap(find.text('12'));
      await tester.pump();
      expect(recebidos, [DateTime(2026, 10, 12)]);
    });

    testWidgets('abre no mês do dia selecionado', (tester) async {
      await tester.pumpWidget(app(DisponibilidadeCalendario(
        diasDisponiveis: {...dias, DateTime(2026, 11, 3)},
        selecionado: DateTime(2026, 11, 3),
        onSelecionar: (_) {},
      )));
      await tester.pumpAndSettle();
      expect(find.text('Novembro de 2026'), findsOneWidget);
    });

    testWidgets('leitor de tela: cada dia anuncia disponível, indisponível ou selecionado', (tester) async {
      final semantica = tester.ensureSemantics();
      await tester.pumpWidget(app(DisponibilidadeCalendario(
        diasDisponiveis: dias,
        selecionado: DateTime(2026, 10, 10),
        onSelecionar: (_) {},
      )));
      await tester.pumpAndSettle();

      expect(
        tester.getSemantics(find.text('12')),
        isSemantics(label: 'segunda-feira, 12 de outubro de 2026', value: 'disponível', isSelected: false),
      );
      expect(
        tester.getSemantics(find.text('11')),
        isSemantics(label: 'domingo, 11 de outubro de 2026', value: 'indisponível', isSelected: false),
      );
      expect(
        tester.getSemantics(find.text('10')),
        isSemantics(label: 'sábado, 10 de outubro de 2026', value: 'selecionado', isSelected: true),
      );
      semantica.dispose();
    });

    testWidgets('conjunto vazio mostra estado vazio', (tester) async {
      await tester.pumpWidget(app(DisponibilidadeCalendario(
        diasDisponiveis: const {},
        onSelecionar: (_) {},
      )));
      expect(find.text('Nenhum dia disponível no momento'), findsOneWidget);
    });

    testWidgets('renderiza no tema escuro', (tester) async {
      await tester.pumpWidget(app(
        DisponibilidadeCalendario(diasDisponiveis: dias, selecionado: DateTime(2026, 10, 12), onSelecionar: (_) {}),
        brightness: Brightness.dark,
      ));
      await tester.pumpAndSettle();
      expect(find.text('12'), findsOneWidget);
    });
  });

  testWidgets('cabe em tela estreita (320dp) sem overflow', (tester) async {
    tester.view.physicalSize = const Size(320, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(app(Column(children: [
      MinhaReservaCard(
        reserva: const {
          'bloco': 'Bloco Residencial Norte',
          'apto': '1204',
          'data': '11/10/2026',
          'horaDe': '10:00',
          'horaAte': '22:30',
          'status': 'aguardando documentação',
          'convidados': 150,
        },
        mostrarApto: true,
        onEditar: () {},
      ),
      HorarioCard(de: '10:00', ate: '22:30', selecionado: true, onTap: () {}),
      ConvidadosStepper(valor: 150, capacidade: 200, onChanged: (_) {}),
      const ResumoReserva(
        area: 'Salão de festas com churrasqueira e piscina',
        data: '11/10/2026',
        horario: '10:00 - 22:30',
        convidados: 150,
        bloco: 'Bloco Residencial Norte',
        apto: '1204',
      ),
      DisponibilidadeCalendario(diasDisponiveis: {DateTime(2026, 10, 12)}, onSelecionar: (_) {}),
    ])));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
