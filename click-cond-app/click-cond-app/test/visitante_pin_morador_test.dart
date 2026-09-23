import 'package:flutter_test/flutter_test.dart';
import 'package:click/pages/shared/visitantes/list_visitantes.dart';

void main() {
  group('temPinParaExibir', () {
    test('permite mostrar um PIN não vazio recebido para o morador', () {
      expect(temPinParaExibir({'codigo_acesso': '123456'}), isTrue);
    });

    test('não permite copiar ou compartilhar PIN ausente, nulo ou vazio', () {
      expect(temPinParaExibir({}), isFalse);
      expect(temPinParaExibir({'codigo_acesso': null}), isFalse);
      expect(temPinParaExibir({'codigo_acesso': '   '}), isFalse);
    });
  });
}
