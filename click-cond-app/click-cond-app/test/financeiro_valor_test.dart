import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/financeiro_constants.dart';

/// Regressão de um bug que corrompia dinheiro em silêncio.
///
/// Os formulários preenchiam o campo de valor com o número CRU da API
/// (`obj['valor'].toString()` → "1250.75", ponto decimal) e, ao salvar,
/// faziam `replaceAll('.', '')` supondo que todo ponto era separador de
/// milhar. O ponto decimal sumia: uma cobrança de R$ 1.250,75 era gravada
/// como R$ 125.075,00. Bastava o síndico abrir um lançamento com centavos e
/// apertar Salvar sem mudar nada.
void main() {
  group('parseValorMoeda', () {
    test('formato BR com milhar e centavos', () {
      expect(parseValorMoeda('1.250,75'), 1250.75);
      expect(parseValorMoeda('10.000,00'), 10000.0);
    });

    test('formato BR só com vírgula', () {
      expect(parseValorMoeda('650,50'), 650.5);
    });

    test('ponto decimal sozinho é decimal, não milhar (o bug)', () {
      expect(parseValorMoeda('1250.75'), 1250.75);
      expect(parseValorMoeda('650.5'), 650.5);
      expect(parseValorMoeda('180.00'), 180.0);
    });

    test('inteiro sem separador', () {
      expect(parseValorMoeda('650'), 650.0);
    });

    test('aceita número direto da API', () {
      expect(parseValorMoeda(1250.75), 1250.75);
      expect(parseValorMoeda(650), 650.0);
    });

    test('ignora símbolo de moeda e espaços', () {
      expect(parseValorMoeda('R\$ 1.250,75'), 1250.75);
    });

    test('vazio e nulo viram zero, sem estourar', () {
      expect(parseValorMoeda(''), 0);
      expect(parseValorMoeda(null), 0);
      expect(parseValorMoeda('abc'), 0);
    });
  });

  group('valorParaInput', () {
    test('número da API vira o texto que o campo de moeda espera', () {
      expect(valorParaInput(1250.75), '1.250,75');
      expect(valorParaInput(650), '650,00');
    });

    test('despesa vem negativa do backend e entra no campo como módulo', () {
      expect(valorParaInput(-1250.75), '1.250,75');
    });

    test('zero deixa o campo vazio em vez de "0,00"', () {
      expect(valorParaInput(0), '');
      expect(valorParaInput(null), '');
    });

    test('ida e volta preserva o valor — o cerne da regressão', () {
      for (final v in [650.0, 1250.75, 10000.0, 99.99, 0.5]) {
        expect(parseValorMoeda(valorParaInput(v)), v);
      }
    });
  });
}
