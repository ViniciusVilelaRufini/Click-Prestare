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
}
