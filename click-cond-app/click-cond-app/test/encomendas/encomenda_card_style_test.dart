import 'package:click/models/encomenda_model.dart';
import 'package:click/pages/shared/encomendas/encomenda_card_style.dart';
import 'package:flutter_test/flutter_test.dart';

EncomendaModel enc({
  int? id,
  String? status,
  String? recebidoEm,
  String? recebidoDe,
  String? retiradoEm,
  String? retiradoPor,
  String? bloco,
  String? apto,
}) =>
    EncomendaModel(
      id: id,
      status: status,
      recebidoEm: recebidoEm,
      recebidoDe: recebidoDe,
      retiradoEm: retiradoEm,
      retiradoPor: retiradoPor,
      destinatarioBloco: bloco,
      destinatarioApto: apto,
    );

void main() {
  final now = DateTime(2026, 10, 4, 15);

  test('encomendaKind classifica os status', () {
    const casos = {
      'retirado': EncomendaKind.entregue,
      'Retirada': EncomendaKind.entregue,
      'entregue': EncomendaKind.entregue,
      'cancelado': EncomendaKind.cancelada,
      'recusado': EncomendaKind.cancelada,
      'esperando': EncomendaKind.esperando,
      'aguardando': EncomendaKind.aguardando,
      'pendente': EncomendaKind.aguardando,
      '': EncomendaKind.aguardando,
    };
    casos.forEach((status, kind) {
      expect(encomendaKind(status), kind, reason: status);
    });
    expect(encomendaKind(null), EncomendaKind.aguardando);
  });

  group('encomendaStatusLine', () {
    final casos = <EncomendaModel, (String, EncomendaTier)>{
      enc(status: 'aguardando', recebidoEm: '2026-10-04T14:59:40'):
          ('Chegou agora', EncomendaTier.normal),
      enc(status: 'aguardando', recebidoEm: '2026-10-04T14:20:00'):
          ('Na portaria há 40 min', EncomendaTier.normal),
      enc(status: 'aguardando', recebidoEm: '2026-10-04T12:00:00'):
          ('Na portaria há 3 h', EncomendaTier.normal),
      enc(status: 'aguardando', recebidoEm: '2026-10-03T10:00:00'):
          ('Na portaria há 1 dia', EncomendaTier.normal),
      enc(status: 'aguardando', recebidoEm: '2026-09-28T18:38:00'):
          ('Na portaria há 6 dias', EncomendaTier.normal),
      enc(status: 'aguardando', recebidoEm: '2026-09-25T10:00:00'):
          ('Na portaria há 9 dias', EncomendaTier.atrasada),
      enc(status: 'aguardando'): ('Na portaria', EncomendaTier.normal),
      enc(status: 'esperando'):
          ('A caminho — ainda não chegou', EncomendaTier.aCaminho),
      enc(
              status: 'retirado',
              retiradoPor: 'Maria',
              retiradoEm: '2026-09-29T10:12:00'):
          ('Retirada por Maria', EncomendaTier.entregue),
      enc(status: 'retirado', retiradoEm: '2026-09-29T10:12:00'):
          ('Retirada', EncomendaTier.entregue),
      enc(status: 'entregue', retiradoPor: 'Maria'):
          ('Retirada por Maria', EncomendaTier.entregue),
      enc(status: 'cancelado', retiradoEm: '2025-12-30T08:00:00'):
          ('Cancelada', EncomendaTier.cancelada),
      enc(status: 'cancelado'): ('Cancelada', EncomendaTier.cancelada),
    };
    var i = 0;
    casos.forEach((e, esperado) {
      test('caso ${i++}: ${esperado.$1}', () {
        final linha = encomendaStatusLine(e, now: now);
        expect(linha.text, esperado.$1);
        expect(linha.tier, esperado.$2);
      });
    });
  });

  group('encomendaDoneDate (linha de data das encerradas)', () {
    final casos = <EncomendaModel, String?>{
      enc(status: 'retirado', retiradoEm: '2026-10-04T10:12:00'): 'hoje às 10:12',
      enc(status: 'retirado', retiradoEm: '2026-10-03T21:10:00'): 'ontem às 21:10',
      enc(status: 'retirado', retiradoEm: '2026-09-30T10:12:00'): '30/09 às 10:12',
      enc(status: 'cancelado', retiradoEm: '2025-12-30T08:00:00'):
          '30/12/2025 às 08:00',
      enc(status: 'cancelado', recebidoEm: '2026-10-01T09:00:00'): '01/10 às 09:00',
      enc(status: 'retirado'): null,
      enc(status: 'aguardando', recebidoEm: '2026-10-01T09:00:00'): null,
    };
    casos.forEach((e, esperado) {
      test('${e.status} ${e.retiradoEm ?? e.recebidoEm}', () {
        expect(encomendaDoneDate(e, now: now), esperado);
      });
    });
  });

  group('encomendaMetaLine', () {
    final casos = <EncomendaModel, String?>{
      enc(
              status: 'aguardando',
              recebidoDe: 'Correios',
              recebidoEm: '2026-09-28T18:38:00'):
          'Correios · chegou 28/09 às 18:38',
      enc(status: 'aguardando', recebidoDe: 'N/A', recebidoEm: '2026-09-28T18:38:00'):
          'chegou 28/09 às 18:38',
      enc(status: 'aguardando', recebidoDe: '  ', recebidoEm: '2026-09-28T18:38:00'):
          'chegou 28/09 às 18:38',
      enc(status: 'esperando', recebidoDe: 'iFood'): 'iFood',
      enc(status: 'esperando'): null,
    };
    casos.forEach((e, esperado) {
      test('${e.status} ${e.recebidoDe}', () {
        expect(encomendaMetaLine(e, now: now), esperado);
      });
    });
  });

  group('selo da unidade', () {
    test('rótulo com bloco e apto', () {
      expect(encomendaUnitLabel(enc(bloco: 'A', apto: '106')), isNotNull);
      expect(encomendaUnitLabel(enc(bloco: 'A', apto: '106')),
          endsWith('• Apto 106'));
      expect(encomendaUnitLabel(enc(apto: '106')), 'Apto 106');
      expect(encomendaUnitLabel(enc()), isNull);
    });

    test('aparece para a equipe ou quando há mais de uma unidade na lista', () {
      final umaUnidade = [
        enc(bloco: 'A', apto: '106'),
        enc(bloco: 'A', apto: '106'),
      ];
      final duasUnidades = [
        enc(bloco: 'A', apto: '106'),
        enc(bloco: 'B', apto: '106'),
      ];
      expect(showUnitBadge(umaUnidade, isStaff: false), isFalse);
      expect(showUnitBadge(duasUnidades, isStaff: false), isTrue);
      expect(showUnitBadge(umaUnidade, isStaff: true), isTrue);
      expect(showUnitBadge(const [], isStaff: false), isFalse);
    });
  });

  group('encomendaSections', () {
    final esperando = enc(id: 1, status: 'esperando');
    final antiga =
        enc(id: 2, status: 'aguardando', recebidoEm: '2026-09-28T10:00:00');
    final recente =
        enc(id: 3, status: 'aguardando', recebidoEm: '2026-10-04T10:00:00');
    final entregueHoje = enc(
        id: 4,
        status: 'retirado',
        recebidoEm: '2026-10-01T10:00:00',
        retiradoEm: '2026-10-04T09:00:00');
    final entregueOntem = enc(
        id: 5,
        status: 'retirado',
        recebidoEm: '2026-10-01T10:00:00',
        retiradoEm: '2026-10-03T09:00:00');
    final cancelada =
        enc(id: 6, status: 'cancelado', recebidoEm: '2026-10-04T11:00:00');
    final todas = [
      entregueOntem,
      recente,
      cancelada,
      esperando,
      entregueHoje,
      antiga
    ];

    /// 'Título: ids' por seção (records com listas não comparam por valor).
    /// Seções principais marcadas com '#', cabeçalhos de dia com '-'.
    List<String> resumo(List<EncomendaSection> s) => [
          for (final x in s)
            '${x.major ? '#' : '-'} ${x.title}: ${x.items.map((e) => e.id).join(',')}'
        ];

    test('todas: aguardando primeiro (mais antiga primeiro), depois por dia', () {
      expect(resumo(encomendaSections(todas, EncomendaFiltro.todas, now: now)), [
        '# Aguardando retirada (3): 2,3,1',
        '# Entregues (3): ',
        '- Hoje: 6,4',
        '- Ontem: 5',
      ]);
    });

    test('aguardando: só as que esperam, mais urgente primeiro, sem cabeçalho',
        () {
      expect(
          resumo(encomendaSections(todas, EncomendaFiltro.aguardando, now: now)),
          [
            '# null: 2,3,1',
          ]);
    });

    test('entregues: mais recentes primeiro com cabeçalhos de dia', () {
      expect(
          resumo(encomendaSections(todas, EncomendaFiltro.entregues, now: now)),
          [
            '- Hoje: 6,4',
            '- Ontem: 5',
          ]);
    });

    test('contagens por filtro', () {
      expect(encomendaCount(todas, EncomendaFiltro.todas), 6);
      expect(encomendaCount(todas, EncomendaFiltro.aguardando), 3);
      expect(encomendaCount(todas, EncomendaFiltro.entregues), 3);
    });

    test('lista vazia não gera seções', () {
      expect(encomendaSections(const [], EncomendaFiltro.todas, now: now),
          isEmpty);
    });
  });
}
