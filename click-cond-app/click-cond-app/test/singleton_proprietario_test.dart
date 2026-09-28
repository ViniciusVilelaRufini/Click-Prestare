import 'package:click/pages/singleton.dart';
import 'package:flutter_test/flutter_test.dart';

/// Vazio contava como proprietário: inquilinos e membros viam "Você é o
/// proprietário" e o botão de cadastrar familiar, que o backend recusava.
void main() {
  test('só proprietário explícito é dono do apto', () {
    final s = Singleton.instance;
    for (final (tipo, esperado) in [
      ('proprietario', true),
      ('Proprietário', true),
      ('membro', false),
      ('inquilino', false),
      ('dependente', false),
      (null, false),
      ('', false),
    ]) {
      s.apto_tipo = tipo;
      expect(s.isProprietarioApto(), esperado, reason: '$tipo');
    }
  });
}
