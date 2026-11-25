import 'package:click/utils/rotulo_bloco.dart';
import 'package:click/utils/rotulo_saldo.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('saldo zero não leva rótulo', () {
    expect(rotuloSaldo('R\$ 0,00'), isNull);
    expect(rotuloSaldo('BRL 0,00'), isNull);
    expect(rotuloSaldo('- R\$ 0,00'), isNull);
    expect(rotuloSaldo(''), isNull);
  });
  test('positivo e negativo', () {
    expect(rotuloSaldo('R\$ 1.234,56'), 'POSITIVO');
    expect(rotuloSaldo('R\$ 0,01'), 'POSITIVO');
    expect(rotuloSaldo('- R\$ 10,00'), 'NEGATIVO');
  });
  test('unidade nos cards de reserva usa "Bloco A · Apto 106"', () {
    expect(rotuloUnidadeCard('A', '106'), 'Bloco A · Apto 106');
    expect(rotuloUnidadeCard('Bloco A', '106'), 'Bloco A · Apto 106');
    expect(rotuloUnidadeCard('', '106'), 'Apto 106');
    expect(rotuloUnidadeCard(null, '106'), 'Apto 106');
  });
}
