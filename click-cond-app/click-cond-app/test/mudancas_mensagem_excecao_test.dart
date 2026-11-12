import 'dart:async';

import 'package:click/pages/shared/mudancas/list_mudancas.dart';
import 'package:flutter_test/flutter_test.dart';

/// Aprovar mudança com data passada mostrava "erro genérico" em vez da
/// mensagem do servidor.
void main() {
  const generico = 'Houve um erro';

  test('usa a mensagem lançada como String', () {
    expect(
      mensagemDaExcecao('Não é possível aprovar uma mudança com data passada.', generico),
      'Não é possível aprovar uma mudança com data passada.',
    );
  });

  test('tira o prefixo "Exception: "', () {
    expect(mensagemDaExcecao(Exception('Data inválida'), generico), 'Data inválida');
  });

  test('erro de rede/timeout e mensagem vazia caem no genérico', () {
    expect(mensagemDaExcecao(TimeoutException('x'), generico), generico);
    expect(mensagemDaExcecao('  ', generico), generico);
  });
}
