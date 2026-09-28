import 'package:click/utils/rotulo_bloco.dart';
import 'package:flutter_test/flutter_test.dart';

/// Blocos cadastrados como "Bloco A" apareciam como "Bloco Bloco A".
void main() {
  test('não duplica o prefixo', () {
    expect(rotuloBloco('Bloco A'), 'Bloco A');
    expect(rotuloBloco('bloco b'), 'bloco b');
    expect(rotuloBloco('A'), 'Bloco A');
    expect(rotuloBloco(' C '), 'Bloco C');
    expect(rotuloBloco(''), '');
    expect(rotuloBloco(null), '');
    expect(rotuloBloco('null'), '');
  });
}
