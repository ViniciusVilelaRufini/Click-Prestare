import 'package:click/utils/visitantes_presenca.dart';
import 'package:click/utils/utils.dart';
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

    test('integração com convertStringToDateTimeFormat usando formato da tela (dd/MM/yyyy HH:mm)', () {
      final inicioDt = convertStringToDateTimeFormat('20/09/2026 23:36');
      final terminoDt = convertStringToDateTimeFormat('21/09/2026 23:36');

      expect(inicioDt, isNotNull);
      expect(terminoDt, isNotNull);
      expect(
        validarCadastroVisitante(nome: 'Visitante Teste', inicio: inicioDt, termino: terminoDt),
        isNull,
      );
      expect(inicioDt.toString(), startsWith('2026-09-20 23:36:00'));
      expect(terminoDt.toString(), startsWith('2026-09-21 23:36:00'));
    });

    test('rejeita com chave adequada quando data de início está vazia ou ausente', () {
      final inicioDt = convertStringToDateTimeFormat('');
      final terminoDt = convertStringToDateTimeFormat('21/09/2026 23:36');

      expect(
        validarCadastroVisitante(nome: 'Visitante Teste', inicio: inicioDt, termino: terminoDt),
        'visitante_inicio_obrigatorio',
      );
    });

    test('rejeita com chave adequada quando data de término está vazia ou ausente', () {
      final inicioDt = convertStringToDateTimeFormat('20/09/2026 23:36');
      final terminoDt = convertStringToDateTimeFormat('');

      expect(
        validarCadastroVisitante(nome: 'Visitante Teste', inicio: inicioDt, termino: terminoDt),
        'visitante_termino_obrigatorio',
      );
    });
  });

  group('validarCamposVisitanteDetalhado', () {
    test('identifica múltiplos erros simultaneamente para destaque em tela', () {
      final res = validarCamposVisitanteDetalhado(
        nome: '',
        inicio: null,
        termino: null,
      );

      expect(res.isValid, isFalse);
      expect(res.erroNome, 'visitante_nome_obrigatorio');
      expect(res.erroInicio, 'visitante_inicio_obrigatorio');
      expect(res.erroTermino, 'visitante_termino_obrigatorio');
      expect(res.primeiroErro, 'visitante_nome_obrigatorio');
    });

    test('quando apenas o nome falta, indica erro apenas no nome', () {
      final res = validarCamposVisitanteDetalhado(
        nome: '   ',
        inicio: inicio,
        termino: termino,
      );

      expect(res.isValid, isFalse);
      expect(res.erroNome, 'visitante_nome_obrigatorio');
      expect(res.erroInicio, isNull);
      expect(res.erroTermino, isNull);
    });

    test('quando período for inválido, indica erro de período no término', () {
      final res = validarCamposVisitanteDetalhado(
        nome: 'Visitante Correto',
        inicio: termino,
        termino: inicio,
      );

      expect(res.isValid, isFalse);
      expect(res.erroNome, isNull);
      expect(res.erroInicio, isNull);
      expect(res.erroTermino, 'visitante_periodo_invalido');
    });

    test('passa com sucesso quando todos os campos obrigatórios estão preenchidos', () {
      final res = validarCamposVisitanteDetalhado(
        nome: 'Visitante Correto',
        inicio: inicio,
        termino: termino,
      );

      expect(res.isValid, isTrue);
      expect(res.erroNome, isNull);
      expect(res.erroInicio, isNull);
      expect(res.erroTermino, isNull);
      expect(res.primeiroErro, isNull);
    });
  });
}
