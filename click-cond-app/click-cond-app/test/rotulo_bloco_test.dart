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

  test('rotuloUnidade não duplica "Bloco" no CSV do relatório', () {
    expect(rotuloUnidade('Bloco A', '12'), 'Bloco A - Apto 12');
    expect(rotuloUnidade('A', '12'), 'Bloco A - Apto 12');
    expect(rotuloUnidade('', '12'), 'Apto 12');
    expect(rotuloUnidade('B', ''), 'Bloco B');
  });
}
