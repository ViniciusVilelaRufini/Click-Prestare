import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/financeiro_constants.dart';
import 'package:click/utils/local_storage.dart';

void main() {
  group('Perfil Porteiro / Funcionário no Módulo Financeiro', () {
    test('porteiro/funcionário não deve ver toggle de Meu Financeiro', () {
      expect(deveExibirToggleFinanceiro('funcionario'), isFalse);
      expect(deveExibirToggleFinanceiro('morador'), isFalse);
      expect(deveExibirToggleFinanceiro('sindico'), isTrue);
    });

    test('porteiro/funcionário deve ter modo financeiro travado no condomínio', () {
      expect(isModoCondominioParaPerfil('funcionario'), isTrue);
      expect(isModoCondominioParaPerfil('sindico'), isTrue);
      expect(isModoCondominioParaPerfil('morador'), isFalse);
    });

    test('porteiro/funcionário não deve carregar dados financeiros pessoais', () {
      expect(deveCarregarFinanceiroPessoal('funcionario'), isFalse);
      expect(deveCarregarFinanceiroPessoal('morador'), isTrue);
      expect(deveCarregarFinanceiroPessoal('sindico'), isTrue);
    });
  });
}
