import 'package:click/utils/financeiro_constants.dart';
import 'package:flutter_test/flutter_test.dart';

/// A que mês pertence um lançamento — a regra que decide se ele aparece ou
/// some quando o usuário troca o mês na tela.
///
/// Estava escrita QUATRO vezes (list_financeiro, morador_financeiro_view, o
/// filtro inline da tela de categoria e morador_relatorio_page), e as cópias
/// divergiam:
///
///  - Só a do relatório fazia `padLeft(2,'0')` no mês. Com "5/9/2026" as
///    outras devolviam "9", que nunca casa com o seletor ("09") — o
///    lançamento simplesmente sumia da tela.
///  - Nenhuma tratava data ISO (yyyy-MM-dd), e o `contains('/')` falha nela:
///    o item caía no fallback e era jogado no MÊS CORRENTE. Como
///    FinanceiroCard._isVencido aceita ISO, esse formato circula no payload.
///  - A cópia inline da tela de categoria devolvia `false` nesse mesmo caso,
///    em vez do mês corrente: o card mostrava "1 pendente" e a tela de
///    detalhe abria vazia.
void main() {
  group('competenciaDe', () {
    test('lê dd/MM/yyyy do vencimento', () {
      final c = competenciaDe({'data_vencimento': '10/09/2026'});
      expect(c.mes, '09');
      expect(c.ano, '2026');
    });

    test('preenche o mês com zero à esquerda (o bug do lançamento sumido)', () {
      final c = competenciaDe({'data_vencimento': '5/9/2026'});
      expect(c.mes, '09');
      expect(c.ano, '2026');
    });

    test('entende data ISO', () {
      expect(competenciaDe({'data_vencimento': '2026-09-10'}).mes, '09');
      expect(competenciaDe({'data_vencimento': '2026-09-10'}).ano, '2026');
    });

    test('entende ISO com hora', () {
      final c = competenciaDe({'data_vencimento': '2026-09-10T03:00:00.000Z'});
      expect(c.mes, '09');
      expect(c.ano, '2026');
    });

    test('cai para o campo data quando não há vencimento', () {
      final c = competenciaDe({'data': '01/12/2026'});
      expect(c.mes, '12');
      expect(c.ano, '2026');
    });

    test('lê a referência do nome quando não há data', () {
      final c = competenciaDe({'nome': 'Taxa condominial Ref. 3/2026'});
      expect(c.mes, '03');
      expect(c.ano, '2026');
    });

    test('referência só com o mês assume o ano corrente', () {
      final agora = DateTime.now();
      final c = competenciaDe({'nome': 'Rateio Ref. 7'});
      expect(c.mes, '07');
      expect(c.ano, agora.year.toString());
    });

    test('sem nenhuma pista, usa o mês corrente', () {
      final agora = DateTime.now();
      final c = competenciaDe({'nome': 'Despesa avulsa'});
      expect(c.mes, agora.month.toString().padLeft(2, '0'));
      expect(c.ano, agora.year.toString());
    });

    test('data vazia não quebra', () {
      expect(() => competenciaDe({'data_vencimento': '', 'data': ''}), returnsNormally);
      expect(() => competenciaDe({}), returnsNormally);
    });

    test('pertenceAo compara mês e ano de uma vez', () {
      final item = {'data_vencimento': '5/9/2026'};
      expect(competenciaDe(item).pertenceAo('09', '2026'), isTrue);
      expect(competenciaDe(item).pertenceAo('9', '2026'), isTrue, reason: 'seletor sem padLeft');
      expect(competenciaDe(item).pertenceAo('10', '2026'), isFalse);
      expect(competenciaDe(item).pertenceAo('09', '2025'), isFalse);
    });
  });
}
