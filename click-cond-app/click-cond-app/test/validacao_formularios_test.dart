import 'package:click/utils/validacao_formularios.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('validarAssembleia', () {
    test('título vazio ou só espaços', () {
      expect(validarAssembleia(titulo: '  ', data: '01/12/2026', hora: '19:00'),
          'Informe o título da assembleia.');
    });
    test('data ou hora vazias', () {
      expect(validarAssembleia(titulo: 'AGO', data: '', hora: '19:00'),
          'Informe a data e a hora da assembleia.');
      expect(validarAssembleia(titulo: 'AGO', data: '01/12/2026', hora: ''),
          'Informe a data e a hora da assembleia.');
    });
    test('ok', () {
      expect(validarAssembleia(titulo: 'AGO', data: '01/12/2026', hora: '19:00'), isNull);
    });
  });

  group('validarComunicado', () {
    test('título e descrição', () {
      expect(validarComunicado(titulo: '', descricao: 'x'), 'Informe o título do comunicado.');
      expect(validarComunicado(titulo: 'a', descricao: ' '), 'Informe a descrição do comunicado.');
      expect(validarComunicado(titulo: 'a', descricao: 'b'), isNull);
    });
  });

  group('mudancaDataPassada', () {
    final hoje = DateTime(2026, 11, 12, 15);
    test('dia anterior é passado', () {
      expect(mudancaDataPassada('28/09/2026', hoje: hoje), isTrue);
      expect(mudancaDataPassada('11/11/2026', hoje: hoje), isTrue);
      expect(mudancaDataPassada('2026-09-28', hoje: hoje), isTrue);
    });
    test('hoje e futuro não são', () {
      expect(mudancaDataPassada('12/11/2026', hoje: hoje), isFalse);
      expect(mudancaDataPassada('13/11/2026', hoje: hoje), isFalse);
    });
    test('vazio ou ilegível não é', () {
      expect(mudancaDataPassada('', hoje: hoje), isFalse);
      expect(mudancaDataPassada(null, hoje: hoje), isFalse);
      expect(mudancaDataPassada('abc', hoje: hoje), isFalse);
    });
  });
}
