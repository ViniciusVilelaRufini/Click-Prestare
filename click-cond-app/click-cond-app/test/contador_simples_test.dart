import 'package:click/utils/utils.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('contadorSimples não põe zero à esquerda', () {
    expect(contadorSimples(4), '4');
    expect(contadorSimples('1'), '1');
    expect(contadorSimples(null), '0');
    expect(contadorSimples('x'), '0');
    expect(contadorSimples(12), '12');
  });
}
