import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/eventos_utils.dart';

void main() {
  group('Título da seção de Eventos de Acesso', () {
    test('exibe "Eventos do condomínio" para perfil funcionário/porteiro', () {
      expect(tituloSecaoEventos('funcionario'), 'Eventos do condomínio');
    });

    test('exibe "Meus eventos" para moradores e outros perfis', () {
      expect(tituloSecaoEventos('morador'), 'Meus eventos');
      expect(tituloSecaoEventos('sindico'), 'Meus eventos');
      expect(tituloSecaoEventos(''), 'Meus eventos');
    });
  });
}
