import 'package:click/utils/rotulo_tipo_morador.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('rótulos com acento', () {
    expect(rotuloTipoMorador('Proprietario'), 'Proprietário');
    expect(rotuloTipoMorador('proprietario'), 'Proprietário');
    expect(rotuloTipoMorador('Proprietário'), 'Proprietário');
    expect(rotuloTipoMorador('Inquilino'), 'Inquilino');
    expect(rotuloTipoMorador('Dependente'), 'Dependente');
    expect(rotuloTipoMorador('membro'), 'Dependente');
    expect(rotuloTipoMorador(null), 'Proprietário');
    expect(rotuloTipoMorador('Outro'), 'Outro');
  });
  test('normalização trata membro como dependente', () {
    expect(tipoMoradorNormalizado('Membro'), 'dependente');
    expect(tipoMoradorNormalizado('Proprietário'), 'proprietario');
  });
}
