import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Os módulos do condomínio usam ícones em PNG (degradê da marca). Um caminho
/// errado só aparece em tempo de execução, como um quadrado quebrado.
void main() {
  final fonte = File('lib/pages/shared/my_condominium.dart').readAsStringSync();
  final usados = RegExp(r"assets/images/modulos/[a-z_]+\.png")
      .allMatches(fonte)
      .map((m) => m.group(0)!)
      .toSet();

  test('todo módulo do menu tem ícone próprio', () {
    // 13 fixos + Apartamentos/Meu apartamento + Delivery + Moradores + Relatórios
    expect(usados.length, greaterThanOrEqualTo(17));
  });

  test('todo ícone usado existe no disco', () {
    for (final caminho in usados) {
      expect(File(caminho).existsSync(), isTrue, reason: caminho);
    }
  });

  test('a pasta dos ícones está declarada no pubspec', () {
    expect(File('pubspec.yaml').readAsStringSync(),
        contains('- assets/images/modulos/'));
  });
}
