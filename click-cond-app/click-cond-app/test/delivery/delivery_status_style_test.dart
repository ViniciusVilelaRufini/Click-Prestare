import 'package:click/models/delivery_model.dart';
import 'package:click/pages/shared/delivery/delivery_status_style.dart';
import 'package:click/theme/app_colors.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('isAtiva', () {
    test('considera em andamento tudo que não foi encerrado', () {
      for (final status in [
        'AGENDADA',
        'CHEGOU',
        'AGUARDANDO_AUTORIZACAO',
        'AUTORIZADA',
        'RETIRADA_NA_PORTARIA',
      ]) {
        expect(isAtiva(status), isTrue, reason: status);
      }
    });

    test('concluída, cancelada e recusada vão para o histórico', () {
      for (final status in ['CONCLUIDA', 'CANCELADA', 'RECUSADA']) {
        expect(isAtiva(status), isFalse, reason: status);
      }
    });
  });

  group('deliveryStepIndex', () {
    test('mapeia o fluxo Aviso → Chegou → Autorização → Concluída', () {
      expect(deliveryStepIndex('AGENDADA'), 0);
      expect(deliveryStepIndex('CHEGOU'), 1);
      expect(deliveryStepIndex('AGUARDANDO_AUTORIZACAO'), 2);
      expect(deliveryStepIndex('AUTORIZADA'), 2);
      expect(deliveryStepIndex('RETIRADA_NA_PORTARIA'), 2);
      expect(deliveryStepIndex('CONCLUIDA'), 3);
    });

    test('cancelada e recusada ficam fora do fluxo', () {
      expect(deliveryStepIndex('CANCELADA'), -1);
      expect(deliveryStepIndex('RECUSADA'), -1);
    });

    test('status desconhecido começa no aviso', () {
      expect(deliveryStepIndex('QUALQUER'), 0);
    });

    test('expõe os rótulos das quatro etapas', () {
      expect(deliverySteps, ['Aviso', 'Chegou', 'Autorização', 'Concluída']);
    });
  });

  group('relativeTime', () {
    final now = DateTime(2026, 10, 4, 15, 0);

    test('menos de um minuto é "agora"', () {
      expect(relativeTime('2026-10-04T14:59:30', now: now), 'agora');
      expect(relativeTime('2026-10-04T15:00:20', now: now), 'agora');
    });

    test('minutos e horas no passado recente', () {
      expect(relativeTime('2026-10-04T14:55:00', now: now), 'há 5 min');
      expect(relativeTime('2026-10-04T13:00:00', now: now), 'há 2 h');
    });

    test('mais antigo no mesmo dia mostra "hoje HH:mm"', () {
      expect(relativeTime('2026-10-04T08:30:00', now: now), 'hoje 08:30');
    });

    test('dia anterior mostra "ontem HH:mm"', () {
      expect(relativeTime('2026-10-03T14:30:00', now: now), 'ontem 14:30');
    });

    test('datas mais antigas mostram dd/MM HH:mm', () {
      expect(relativeTime('2026-09-27T18:05:00', now: now), '27/09 18:05');
    });

    test('ano diferente inclui o ano', () {
      expect(relativeTime('2025-12-31T23:10:00', now: now), '31/12/2025 23:10');
    });

    test('futuro próximo e mais distante', () {
      expect(relativeTime('2026-10-04T15:20:00', now: now), 'em 20 min');
      expect(relativeTime('2026-10-04T19:45:00', now: now), 'hoje 19:45');
      expect(relativeTime('2026-10-05T09:00:00', now: now), 'amanhã 09:00');
      expect(relativeTime('2026-10-10T09:00:00', now: now), '10/10 09:00');
    });

    test('valor inválido é devolvido como veio', () {
      expect(relativeTime('sem data', now: now), 'sem data');
    });
  });

  test('formatDeliveryDate usa dd/MM/yyyy HH:mm', () {
    expect(formatDeliveryDate('2026-09-27T18:05:00'), '27/09/2026 18:05');
    expect(formatDeliveryDate('inválida'), 'inválida');
  });

  group('deliveryTimeLabel', () {
    final now = DateTime(2026, 10, 4, 15, 0);

    test('aviso ativo com previsão futura mostra a previsão', () {
      const d = DeliveryModel(
        status: 'AGENDADA',
        previsaoEm: '2026-10-04T19:45:00',
        createdAt: '2026-10-04T14:55:00',
      );
      expect(deliveryTimeLabel(d, now: now), 'Previsão hoje 19:45');
    });

    test('sem previsão (ou previsão antiga) usa a criação', () {
      const semPrevisao =
          DeliveryModel(status: 'CHEGOU', createdAt: '2026-10-04T14:55:00');
      const previsaoAntiga = DeliveryModel(
        status: 'AGENDADA',
        previsaoEm: '2026-10-03T10:00:00',
        createdAt: '2026-10-04T14:55:00',
      );
      expect(deliveryTimeLabel(semPrevisao, now: now), 'há 5 min');
      expect(deliveryTimeLabel(previsaoAntiga, now: now), 'há 5 min');
    });

    test('encerrada ignora a previsão', () {
      const d = DeliveryModel(
        status: 'CONCLUIDA',
        previsaoEm: '2026-10-04T19:45:00',
        createdAt: '2026-10-03T14:30:00',
      );
      expect(deliveryTimeLabel(d, now: now), 'ontem 14:30');
    });

    test('sem datas não mostra nada', () {
      expect(deliveryTimeLabel(const DeliveryModel(), now: now), isNull);
    });
  });

  group('splitDeliveries', () {
    const concluidaAntiga = DeliveryModel(
        id: 1, status: 'CONCLUIDA', createdAt: '2026-10-01T10:00:00');
    const canceladaNova = DeliveryModel(
        id: 2, status: 'CANCELADA', createdAt: '2026-10-03T10:00:00');
    const agendadaNova = DeliveryModel(
        id: 3, status: 'AGENDADA', createdAt: '2026-10-04T12:00:00');
    const chegouAntiga = DeliveryModel(
        id: 4, status: 'CHEGOU', createdAt: '2026-10-04T08:00:00');
    const aguardando = DeliveryModel(
        id: 5,
        status: 'AGUARDANDO_AUTORIZACAO',
        createdAt: '2026-10-02T08:00:00');
    const agendadaAntiga = DeliveryModel(
        id: 6, status: 'AGENDADA', createdAt: '2026-10-04T09:00:00');
    const recusadaSemData = DeliveryModel(id: 7, status: 'RECUSADA');

    final split = splitDeliveries([
      concluidaAntiga,
      canceladaNova,
      agendadaNova,
      chegouAntiga,
      aguardando,
      agendadaAntiga,
      recusadaSemData,
    ]);

    test('ativas: resposta pendente, depois chegou, depois o resto (mais novo primeiro)',
        () {
      expect(split.ativas.map((d) => d.id), [5, 4, 3, 6]);
    });

    test('histórico: mais novo primeiro, sem data no fim', () {
      expect(split.historico.map((d) => d.id), [2, 1, 7]);
    });
  });

  group('DeliveryStatusStyle', () {
    test('cada status tem rótulo curto e cor própria', () {
      expect(DeliveryStatusStyle.of('AGUARDANDO_AUTORIZACAO').label,
          'Aguardando você');
      expect(DeliveryStatusStyle.of('CONCLUIDA').label, 'Concluída');
      expect(DeliveryStatusStyle.of('CONCLUIDA').color, AppColors.success);
      expect(DeliveryStatusStyle.of('RECUSADA').color, AppColors.error);
      expect(DeliveryStatusStyle.of('CANCELADA').color, AppColors.error);
      expect(DeliveryStatusStyle.of('DESCONHECIDO').label,
          DeliveryStatusStyle.of('AGENDADA').label);
    });
  });

  testWidgets('DeliveryStatusBadge mostra o rótulo curto nos dois temas',
      (tester) async {
    for (final theme in [ThemeData.light(), ThemeData.dark()]) {
      await tester.pumpWidget(MaterialApp(
        theme: theme,
        home: const Scaffold(body: DeliveryStatusBadge(status: 'CHEGOU')),
      ));
      expect(find.text('Chegou'), findsOneWidget);
    }
  });
  group('etapas: ícones e horários', () {
    test('cada etapa tem um ícone próprio', () {
      final icons = List.generate(4, deliveryStepIcon);
      expect(icons.toSet().length, 4);
    });

    test('horário de cada etapa vem do primeiro evento que a alcançou', () {
      final d = DeliveryModel.fromJson({
        'status': 'CONCLUIDA',
        'created_at': '2026-10-04T13:55:00',
        'eventos': [
          {'status_novo': 'AGENDADA', 'created_at': '2026-10-04T14:00:00'},
          {'status_novo': 'CHEGOU', 'created_at': '2026-10-04T14:20:00'},
          {
            'status_novo': 'AGUARDANDO_AUTORIZACAO',
            'created_at': '2026-10-04T14:21:00'
          },
          {'status_novo': 'AUTORIZADA', 'created_at': '2026-10-04T14:23:00'},
          {'status_novo': 'CONCLUIDA', 'created_at': '2026-10-04T14:40:00'},
        ],
      });
      expect(deliveryStepTimes(d), [
        '2026-10-04T14:00:00',
        '2026-10-04T14:20:00',
        '2026-10-04T14:21:00',
        '2026-10-04T14:40:00',
      ]);
    });

    test('sem evento de aviso usa a criação; etapas não alcançadas ficam vazias',
        () {
      const d =
          DeliveryModel(status: 'AGENDADA', createdAt: '2026-10-04T13:55:00');
      expect(deliveryStepTimes(d), ['2026-10-04T13:55:00', null, null, null]);
    });

    test('formatStepTime: HH:mm no dia, dd/MM em outros dias', () {
      final now = DateTime(2026, 10, 4, 15);
      expect(formatStepTime('2026-10-04T14:20:00', now: now), '14:20');
      expect(formatStepTime('2026-10-02T14:20:00', now: now), '02/10');
      expect(formatStepTime('x', now: now), '');
    });
  });

  group('deliveryContextLine', () {
    final now = DateTime(2026, 10, 4, 22, 30);
    DeliveryModel com(String status, String? quando,
            {String? previsao, String? criado}) =>
        DeliveryModel(
          status: status,
          previsaoEm: previsao,
          createdAt: criado,
          eventos: quando == null
              ? const []
              : [DeliveryEvent(statusNovo: status, createdAt: quando)],
        );

    test('concluída mostra o horário e o relativo', () {
      expect(
          deliveryContextLine(com('CONCLUIDA', '2026-10-04T21:22:00'),
              now: now),
          'Concluída às 21:22 · há 1 h');
      expect(
          deliveryContextLine(com('CONCLUIDA', '2026-10-03T21:22:00'),
              now: now),
          'Concluída ontem 21:22');
    });

    test('chegou mostra há quanto tempo', () {
      expect(
          deliveryContextLine(com('CHEGOU', '2026-10-04T22:25:00'), now: now),
          'Chegou há 5 min');
    });

    test('agendada usa a previsão, senão a criação', () {
      expect(
          deliveryContextLine(
              com('AGENDADA', null, previsao: '2026-10-05T14:30:00'),
              now: DateTime(2026, 10, 5, 9)),
          'Aviso para hoje 14:30');
      expect(
          deliveryContextLine(
              com('AGENDADA', null, previsao: '2026-10-04T22:50:00'),
              now: now),
          'Previsão em 20 min');
      expect(
          deliveryContextLine(
              com('AGENDADA', null, criado: '2026-10-04T22:28:00'),
              now: now),
          'Avisado há 2 min');
    });

    test('demais status com e sem horário', () {
      expect(
          deliveryContextLine(
              com('AGUARDANDO_AUTORIZACAO', '2026-10-04T22:28:00'),
              now: now),
          'Autorização pedida há 2 min');
      expect(
          deliveryContextLine(com('RECUSADA', '2026-09-27T10:00:00'),
              now: now),
          'Recusada em 27/09 10:00');
      expect(deliveryContextLine(com('CANCELADA', null), now: now),
          'Cancelada');
    });
  });

  group('deliveryNextStep (O que acontece agora?)', () {
    const casos = {
      'AGENDADA':
          'Avisamos a portaria. Quando o entregador chegar, você será notificado.',
      'CHEGOU':
          'O entregador está na portaria. A portaria vai pedir sua autorização.',
      'AGUARDANDO_AUTORIZACAO':
          'A portaria só libera a entrada depois da sua resposta.',
      'AUTORIZADA':
          'Entrega liberada. O entregador está a caminho do seu apartamento.',
      'RETIRADA_NA_PORTARIA':
          'Sua entrega ficou na portaria. Retire quando puder.',
      'CONCLUIDA': 'Tudo certo — nada a fazer.',
      'CANCELADA':
          'Este aviso foi cancelado. Se ainda precisar, avise uma nova entrega.',
      'RECUSADA':
          'A entrega foi recusada e o entregador não foi liberado. Se precisar, avise uma nova entrega.',
    };
    casos.forEach((status, texto) {
      test(status, () {
        expect(deliveryNextStep(DeliveryModel(status: status)).text, texto);
      });
    });

    test('autorizada para retirar na portaria muda a frase', () {
      expect(
          deliveryNextStep(const DeliveryModel(
                  status: 'AUTORIZADA', modoEntrega: 'PORTARIA'))
              .text,
          'Entrega liberada. Ela vai ficar na portaria para você retirar.');
    });
  });

  group('agrupamento por dia', () {
    final now = DateTime(2026, 10, 4, 15);

    test('rótulos do dia', () {
      expect(deliveryDayLabel(DateTime(2026, 10, 4, 1), now: now), 'Hoje');
      expect(deliveryDayLabel(DateTime(2026, 10, 3, 23), now: now), 'Ontem');
      expect(
          deliveryDayLabel(DateTime(2026, 9, 27, 8), now: now), '27 de set');
      expect(deliveryDayLabel(DateTime(2025, 12, 31, 8), now: now),
          '31 de dez de 2025');
      expect(deliveryDayLabel(null, now: now), 'Sem data');
    });

    test('junta o mesmo dia mantendo a ordem da primeira aparição', () {
      const a = DeliveryModel(id: 1, createdAt: '2026-10-04T12:00:00');
      const b = DeliveryModel(id: 2, createdAt: '2026-10-03T12:00:00');
      const c = DeliveryModel(id: 3, createdAt: '2026-10-04T09:00:00');
      const d = DeliveryModel(id: 4, createdAt: '2026-09-27T09:00:00');
      final grupos = groupDeliveriesByDay([a, b, c, d], now: now);
      expect(grupos.map((g) => g.label), ['Hoje', 'Ontem', '27 de set']);
      expect(grupos.first.items.map((x) => x.id), [1, 3]);
    });
  });

  test('deliverySummary conta o que importa e esconde zeros', () {
    expect(deliverySummary(const []), isEmpty);
    expect(
        deliverySummary(const [
          DeliveryModel(status: 'AGUARDANDO_AUTORIZACAO'),
          DeliveryModel(status: 'CHEGOU'),
          DeliveryModel(status: 'CONCLUIDA'),
          DeliveryModel(status: 'CONCLUIDA'),
          DeliveryModel(status: 'CANCELADA'),
        ]),
        ['1 aguardando você', '1 em andamento', '2 concluídas']);
    expect(deliverySummary(const [DeliveryModel(status: 'CONCLUIDA')]),
        ['1 concluída']);
  });

  test('deliveryTitle usa o estabelecimento ou um texto padrão', () {
    expect(deliveryTitle(const DeliveryModel(estabelecimento: ' Mercado ')),
        'Mercado');
    expect(deliveryTitle(const DeliveryModel()), 'Entrega avisada');
  });

  test('onColor garante contraste sobre a cor do status', () {
    expect(DeliveryStatusStyle.of('CHEGOU').onColor, isNot(Colors.white));
    expect(DeliveryStatusStyle.of('AGENDADA').onColor, Colors.white);
  });
  group('card do histórico', () {
    final now = DateTime(2026, 10, 4, 15);
    DeliveryModel encerrado(String status,
            {String? inicio,
            String? fim,
            String? criado,
            String? motivo,
            String? modo}) =>
        DeliveryModel(
          status: status,
          createdAt: criado,
          motivo: motivo,
          modoEntrega: modo,
          eventos: [
            if (inicio != null)
              DeliveryEvent(statusNovo: 'AGENDADA', createdAt: inicio),
            if (fim != null) DeliveryEvent(statusNovo: status, createdAt: fim),
          ],
        );

    test('deliveryOutcomeLine: desfecho + quando', () {
      final casos = <DeliveryModel, String>{
        encerrado('CONCLUIDA', fim: '2026-10-04T00:29:00'):
            'Concluída hoje às 00:29',
        encerrado('RECUSADA', fim: '2026-10-03T21:10:00'):
            'Recusada ontem às 21:10',
        encerrado('CANCELADA', fim: '2026-10-01T14:00:00'):
            'Cancelada 01/10 às 14:00',
        encerrado('CONCLUIDA', criado: '2025-12-31T23:10:00'):
            'Concluída 31/12/2025 às 23:10',
        encerrado('RECUSADA'): 'Recusada',
      };
      casos.forEach((aviso, esperado) {
        expect(deliveryOutcomeLine(aviso, now: now), esperado);
      });
    });

    test('deliveryDuration: do primeiro evento ao desfecho', () {
      final casos = <DeliveryModel, String?>{
        encerrado('CONCLUIDA',
            inicio: '2026-10-04T10:00:00', fim: '2026-10-04T10:12:00'): 'Levou 12 min',
        encerrado('CONCLUIDA',
            inicio: '2026-10-04T10:00:00', fim: '2026-10-04T11:05:00'): 'Levou 1 h 5 min',
        encerrado('CONCLUIDA',
            inicio: '2026-10-04T10:00:00', fim: '2026-10-04T12:00:00'): 'Levou 2 h',
        encerrado('CONCLUIDA',
            inicio: '2026-10-04T10:00:00', fim: '2026-10-04T10:00:30'): null,
        encerrado('CONCLUIDA', fim: '2026-10-04T10:12:00'): null,
        encerrado('CONCLUIDA'): null,
      };
      casos.forEach((aviso, esperado) {
        expect(deliveryDuration(aviso), esperado);
      });
    });

    test('deliveryHistoryMeta: modo + duração, ou motivo nos encerrados negativos',
        () {
      final casos = <DeliveryModel, String>{
        encerrado('CONCLUIDA',
            inicio: '2026-10-04T10:00:00', fim: '2026-10-04T10:12:00'):
            'Na unidade · Levou 12 min',
        encerrado('CONCLUIDA', modo: 'PORTARIA'): 'Na portaria',
        encerrado('RECUSADA',
            inicio: '2026-10-04T10:00:00',
            fim: '2026-10-04T10:12:00',
            motivo: '  Sem identificação  '): 'Na unidade · Sem identificação',
        encerrado('CANCELADA',
            inicio: '2026-10-04T10:00:00', fim: '2026-10-04T10:12:00'):
            'Na unidade',
      };
      casos.forEach((aviso, esperado) {
        expect(deliveryHistoryMeta(aviso), esperado);
      });
    });
  });
}
