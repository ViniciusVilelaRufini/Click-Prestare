import 'package:click/utils/financeiro_constants.dart';
import 'package:flutter_test/flutter_test.dart';

/// Cobranças de condomínio chegam órfãs (sem `id_usuario`), e o app tenta
/// associá-las ao morador pelo NOME do lançamento ("Apto 101 - Bloco A").
///
/// A associação era feita com `contains('apto $meuApto')`, que casa por
/// prefixo: para quem mora no Apto 10, "Apto 101", "Apto 102" e "Apto 1050"
/// TODOS batiam. O morador via — e somava no "Total pendente" — a dívida dos
/// vizinhos. Além de número errado, é dado pessoal de terceiro na tela.
void main() {
  group('faturaDeAptoCorresponde', () {
    test('casa o apartamento exato', () {
      expect(faturaDeAptoCorresponde('Apto 10 - Bloco A', '10', 'A'), isTrue);
    });

    test('NÃO casa apartamento com o mesmo prefixo (o bug)', () {
      expect(faturaDeAptoCorresponde('Apto 101 - Bloco A', '10', 'A'), isFalse);
      expect(faturaDeAptoCorresponde('Apto 1050 - Bloco A', '10', 'A'), isFalse);
      expect(faturaDeAptoCorresponde('Apto 12 - Bloco A', '1', 'A'), isFalse);
    });

    test('NÃO casa bloco com o mesmo prefixo', () {
      expect(faturaDeAptoCorresponde('Apto 10 - Bloco AB', '10', 'A'), isFalse);
    });

    test('ignora caixa e espaço em volta', () {
      expect(faturaDeAptoCorresponde('APTO 10 - BLOCO a', ' 10 ', 'A'), isTrue);
    });

    test('aceita bloco com espaço no nome', () {
      expect(
        faturaDeAptoCorresponde('Apto 1203 - Bloco Torre Norte', '1203', 'Torre Norte'),
        isTrue,
      );
    });

    test('aceita o separador ausente', () {
      expect(faturaDeAptoCorresponde('Apto 10 Bloco A', '10', 'A'), isTrue);
    });

    test('casa fatura com sufixo de taxa condominial e referência (o caso real)', () {
      expect(
        faturaDeAptoCorresponde('Apto 101 Bloco A - Taxa Condominial Ref. 09/2026', '101', 'A'),
        isTrue,
      );
      expect(
        faturaDeAptoCorresponde('Apto 101 - Bloco A - Taxa Condominial Ref. 09/2026', '101', 'A'),
        isTrue,
      );
    });

    test('aceita condomínio sem bloco (unidade de torre única)', () {
      expect(
        faturaDeAptoCorresponde('Apto 101 - Taxa Condominial Ref. 09/2026', '101', ''),
        isTrue,
      );
      // Mas não casa se a fatura pertence a um bloco e o morador não tem bloco
      expect(
        faturaDeAptoCorresponde('Apto 101 Bloco B - Taxa Condominial Ref. 09/2026', '101', ''),
        isFalse,
      );
    });

    test('tolera morador com "Apto 101" ou "Bloco A" preenchidos no perfil', () {
      expect(
        faturaDeAptoCorresponde('Apto 101 Bloco A - Taxa Condominial Ref. 09/2026', 'Apto 101', 'Bloco A'),
        isTrue,
      );
    });

    test('aceita "Apartamento" como variação de "Apto"', () {
      expect(
        faturaDeAptoCorresponde('Apartamento 101 Bloco A - Ref. 09/2026', '101', 'A'),
        isTrue,
      );
    });

    /// Sem apto no Singleton não dá para afirmar titularidade.
    test('sem apto ou bloco do morador, não associa indevidamente', () {
      expect(faturaDeAptoCorresponde('Apto 10 - Bloco A', '', 'A'), isFalse);
      expect(faturaDeAptoCorresponde('Apto 10 - Bloco A', '10', ''), isFalse);
    });

    test('nome fora do padrão não associa', () {
      expect(faturaDeAptoCorresponde('Taxa de lixo do condomínio', '10', 'A'), isFalse);
      expect(faturaDeAptoCorresponde('', '10', 'A'), isFalse);
    });
  });

  group('totaisFinanceiro', () {
    test('separa pago de pendente', () {
      final t = totaisFinanceiro([
        {'valor': 100, 'pago': 1},
        {'valor': 50, 'pago': 0},
      ]);
      expect(t.pago, 100);
      expect(t.pendente, 50);
      expect(t.contasPagas, 1);
      expect(t.totalContas, 2);
    });

    /// O `double.tryParse` cru devolvia null para "1.250,75" e o `?? 0` fazia
    /// a parcela sumir do Total pendente, sem nenhum sinal na tela.
    test('soma valor formatado em BR (o bug)', () {
      final t = totaisFinanceiro([
        {'valor': '1.250,75', 'pago': 0},
        {'valor': 'R\$ 300,25', 'pago': 0},
      ]);
      expect(t.pendente, closeTo(1551.0, 0.001));
    });

    test('aceita pago como String', () {
      final t = totaisFinanceiro([
        {'valor': '100', 'pago': '1'},
        {'valor': '40', 'pago': '0'},
      ]);
      expect(t.pago, 100);
      expect(t.pendente, 40);
    });

    test('lista vazia zera tudo', () {
      final t = totaisFinanceiro([]);
      expect(t.pago, 0);
      expect(t.pendente, 0);
      expect(t.totalContas, 0);
      expect(t.contasPagas, 0);
    });

    test('valor ausente conta como zero, mas a conta continua contada', () {
      final t = totaisFinanceiro([
        {'pago': 0},
        {'valor': null, 'pago': 0},
      ]);
      expect(t.pendente, 0);
      expect(t.totalContas, 2);
    });
  });
}
