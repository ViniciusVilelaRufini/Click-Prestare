import 'package:click/utils/visitantes_presenca.dart';
import 'package:flutter_test/flutter_test.dart';

/// O cadastro de visitante fazia o POST sem validar absolutamente nada.
///
/// Com as datas em branco, `data_hora_termino` ia nula — e aí `isExpired` na
/// lista nunca vira true, o bloco do QR/PIN continua sendo renderizado para
/// sempre e a tela ainda rotula o período como "Qualquer data". Ou seja: um
/// crachá de portaria permanente, criado em dois toques, por engano.
void main() {
  final inicio = DateTime(2026, 9, 14, 8, 0);
  final termino = DateTime(2026, 9, 14, 18, 0);

  group('validarCadastroVisitante', () {
    test('cadastro completo passa', () {
      expect(
        validarCadastroVisitante(nome: 'Maria Silva', inicio: inicio, termino: termino),
        isNull,
      );
    });

    test('exige nome', () {
      expect(
        validarCadastroVisitante(nome: '', inicio: inicio, termino: termino),
        'visitante_nome_obrigatorio',
      );
      expect(
        validarCadastroVisitante(nome: '   ', inicio: inicio, termino: termino),
        'visitante_nome_obrigatorio',
      );
    });

    /// O caso que gerava o PIN eterno.
    test('exige data de término', () {
      expect(
        validarCadastroVisitante(nome: 'Maria Silva', inicio: inicio, termino: null),
        'visitante_termino_obrigatorio',
      );
    });

    test('exige data de início', () {
      expect(
        validarCadastroVisitante(nome: 'Maria Silva', inicio: null, termino: termino),
        'visitante_inicio_obrigatorio',
      );
    });

    test('recusa término antes do início', () {
      expect(
        validarCadastroVisitante(nome: 'Maria Silva', inicio: termino, termino: inicio),
        'visitante_periodo_invalido',
      );
    });

    test('aceita janela de um instante só (início igual ao término)', () {
      expect(
        validarCadastroVisitante(nome: 'Maria Silva', inicio: inicio, termino: inicio),
        isNull,
      );
    });

    /// A ordem importa para a mensagem fazer sentido: quem deixou tudo em
    /// branco precisa ouvir primeiro sobre o nome, não sobre o período.
    test('reclama do nome antes das datas', () {
      expect(
        validarCadastroVisitante(nome: '', inicio: null, termino: null),
        'visitante_nome_obrigatorio',
      );
    });
  });
}
