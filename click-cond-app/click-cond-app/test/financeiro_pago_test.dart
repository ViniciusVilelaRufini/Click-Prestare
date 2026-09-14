import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/financeiro_constants.dart';

/// Regressão: "editei a conta e ela voltou a aparecer como pendente".
///
/// O campo `pago` chega da API ora como int (1), ora como String ("1") — por
/// isso a lista já tinha um helper para interpretá-lo. Os dois modais de
/// edição, porém, comparavam `item['pago'] == 1` de forma estrita: com "1",
/// o switch "Pago" abria DESMARCADO e salvar sem tocar nele mandava `pago: 0`.
/// Uma conta quitada voltava a pendente só por ter sido aberta para edição.
void main() {
  group('isPagoValor', () {
    test('aceita o int 1 da API', () {
      expect(isPagoValor(1), isTrue);
      expect(isPagoValor(0), isFalse);
    });

    test('aceita a String "1" (o bug)', () {
      expect(isPagoValor('1'), isTrue);
      expect(isPagoValor('0'), isFalse);
    });

    test('trata ausência como não pago', () {
      expect(isPagoValor(null), isFalse);
      expect(isPagoValor(''), isFalse);
    });

    /// `status = 2` é "em verificação" e `pago = 2` não é quitação —
    /// só o 1 vale como pago, em qualquer um dos dois tipos.
    test('só 1 conta como pago', () {
      expect(isPagoValor(2), isFalse);
      expect(isPagoValor('2'), isFalse);
      expect(isPagoValor(true), isFalse);
    });

    test('ignora espaço em volta', () {
      expect(isPagoValor(' 1 '), isTrue);
    });
  });
}
