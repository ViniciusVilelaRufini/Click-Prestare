import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/boleto_utils.dart';

void main() {
  group('parseBoletoScan', () {
    test('Código de barras bancário (44 dígitos) extrai linha digitável, valor e vencimento', () {
      // Banco 237 (Bradesco), Fator 9801 (07/08/2024), Valor 0000000900 (R$ 9,00)
      const barcode = '2379198010000000900010000000000000000000000';
      final barcode44 = barcode.padRight(44, '0');
      final result = parseBoletoScan(barcode44);

      expect(result.isEmpty, false);
      expect(result.linhaDigitavel?.length, 47);
      expect(result.valor, 9.0);
      expect(result.valorFormatado, '9,00');
      expect(result.bancoOuTipo, 'Bradesco');
      expect(result.vencimentoFormatado, '07/08/2024');
    });

    test('Linha digitável bancária (47 dígitos) extrai banco, valor e vencimento', () {
      // 47 dígitos bancário com R$ 120,00 e fator 9801
      const linha47 = '23790100080000000000000000000000198010000012000';
      final result = parseBoletoScan(linha47);

      expect(result.isEmpty, false);
      expect(result.linhaDigitavel, linha47);
      expect(result.valor, 120.0);
      expect(result.valorFormatado, '120,00');
      expect(result.bancoOuTipo, 'Bradesco');
      expect(result.vencimentoFormatado, '07/08/2024');
    });

    test('Código de barras de concessionária de Luz (começa com 83) extrai tipo e valor', () {
      // 83 (Luz/Energia), 6 (mod10), valor 00000015000 (R$ 150,00)
      const barcodeLuz = '83600000001500000000000000000000000000000000';
      final result = parseBoletoScan(barcodeLuz);

      expect(result.isEmpty, false);
      expect(result.linhaDigitavel?.length, 48);
      expect(result.valor, 150.0);
      expect(result.valorFormatado, '150,00');
      expect(result.bancoOuTipo, 'Energia Elétrica / Gás');
    });

    test('PIX Copia e Cola (BR Code) extrai tag 54 de valor quando presente', () {
      const pix = '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865406120.505802BR5913Prestare Tech6009Sao Paulo62070503***6304ABCD';
      final result = parseBoletoScan(pix);

      expect(result.isEmpty, false);
      expect(result.pixCopiaCola, pix);
      expect(result.valor, 120.5);
      expect(result.valorFormatado, '120,50');
      expect(result.bancoOuTipo, 'Pix');
    });

    test('String vazia ou inválida retorna resultado vazio', () {
      final resVazio = parseBoletoScan('');
      expect(resVazio.isEmpty, true);

      final resEspaco = parseBoletoScan('   ');
      expect(resEspaco.isEmpty, true);
    });
  });
}
