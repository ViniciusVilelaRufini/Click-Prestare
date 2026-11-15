import 'package:click/utils/rotulo_reserva.dart';
import 'package:click/widgets/cells/cell_agendamento.dart';
import 'package:click/widgets/cells/cell_my_agendamento.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A API passou a devolver `criado_por` (nome de quem agendou) nas reservas.
/// Reserva antiga, ou API sem a coluna ainda, vem sem o campo ou com null —
/// aí a célula fica como era.
void main() {
  group('rotuloAgendadoPor', () {
    test('com o nome, monta o rótulo', () {
      expect(rotuloAgendadoPor({'criado_por': 'Ana Souza'}), 'Agendado por Ana Souza');
      expect(rotuloAgendadoPor({'criado_por': '  Ana  '}), 'Agendado por Ana');
    });

    test('sem o campo, nulo, vazio ou não-texto: nada', () {
      expect(rotuloAgendadoPor({}), isNull);
      expect(rotuloAgendadoPor({'criado_por': null}), isNull);
      expect(rotuloAgendadoPor({'criado_por': '   '}), isNull);
      expect(rotuloAgendadoPor({'criado_por': 42}), isNull);
      expect(rotuloAgendadoPor(null), isNull);
      expect(rotuloAgendadoPor('não é mapa'), isNull);
    });
  });

  Map<String, dynamic> reserva({Object? criadoPor, bool comCampo = true}) => {
        'id': 1,
        'nomeArea': 'Churrasqueira',
        'data': '20/11/2026',
        'horaDe': '10:00',
        'horaAte': '14:00',
        'status': 'aprovado',
        'aprovado_por': 'Síndico Carlos',
        'apto': '101',
        'bloco': 'A',
        'data_criacao': '14/11/2026',
        if (comCampo) 'criado_por': criadoPor,
      };

  Future<void> mostrar(WidgetTester tester, Widget celula) async {
    tester.view.physicalSize = const Size(1800, 3200);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ListView(children: [celula]))));
    await tester.pumpAndSettle();
  }

  for (final tela in ['síndico (CellAgendamento)', 'morador (CellMyAgendamento)']) {
    Widget celula(Map<String, dynamic> item) =>
        tela.startsWith('síndico') ? CellAgendamento(item: item) : CellMyAgendamento(item: item);

    testWidgets('$tela: mostra "Agendado por" junto do "Aprovado por"', (tester) async {
      await mostrar(tester, celula(reserva(criadoPor: 'Ana Souza')));
      expect(find.text('Agendado por Ana Souza'), findsOneWidget);
      expect(find.textContaining('Aprovado por Síndico Carlos'), findsOneWidget);
    });

    testWidgets('$tela: sem criado_por, nada muda', (tester) async {
      await mostrar(tester, celula(reserva(comCampo: false)));
      expect(find.textContaining('Agendado por'), findsNothing);
      await mostrar(tester, celula(reserva(criadoPor: null)));
      expect(find.textContaining('Agendado por'), findsNothing);
      expect(find.textContaining('Aprovado por Síndico Carlos'), findsOneWidget);
    });
  }
}
