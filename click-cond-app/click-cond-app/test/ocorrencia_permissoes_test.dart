import 'package:click/utils/ocorrencia_permissoes.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('podeEditarOcorrencia', () {
    test('autor com ocorrência Pendente pode', () {
      expect(podeEditarOcorrencia({'user': 100, 'status': 'Pendente'}, '100'), isTrue);
    });
    test('status em outra caixa ou nulo conta como pendente', () {
      expect(podeEditarOcorrencia({'user': 100, 'status': 'pendente'}, '100'), isTrue);
      expect(podeEditarOcorrencia({'user': 100, 'status': null}, '100'), isTrue);
    });
    test('quem não é o autor não pode', () {
      expect(podeEditarOcorrencia({'user': 101, 'status': 'Pendente'}, '100'), isFalse);
      expect(podeEditarOcorrencia({'user': 100, 'status': 'Pendente'}, ''), isFalse);
    });
    test('já atendida não pode', () {
      expect(podeEditarOcorrencia({'user': 100, 'status': 'Ciente'}, '100'), isFalse);
      expect(podeEditarOcorrencia({'user': 100, 'status': 'Solucionado'}, '100'), isFalse);
    });
    test('sem ocorrência carregada não pode', () {
      expect(podeEditarOcorrencia(null, '100'), isFalse);
    });

    // A API recusa editar/excluir quando a equipe já respondeu (resposta_at)
    // ou escreveu no chat, mesmo com a ocorrência ainda Pendente.
    test('com resposta pública da administração não pode', () {
      expect(
        podeEditarOcorrencia(
            {'user': 100, 'status': 'Pendente', 'resposta': 'Vamos verificar.', 'resposta_at': '2026-11-14T10:00:00Z'},
            '100'),
        isFalse,
      );
      expect(podeEditarOcorrencia({'user': 100, 'status': 'Pendente', 'resposta': '', 'resposta_at': '2026-11-14T10:00:00Z'}, '100'),
          isFalse);
      expect(podeEditarOcorrencia({'user': 100, 'status': 'Pendente', 'resposta': 'Ok'}, '100'), isFalse);
    });

    test('resposta vazia e sem data não conta', () {
      expect(podeEditarOcorrencia({'user': 100, 'status': 'Pendente', 'resposta': '  ', 'resposta_at': null}, '100'), isTrue);
    });

    test('mensagem da equipe no chat não pode', () {
      final oc = {'user': 100, 'status': 'Pendente', 'resposta': ''};
      expect(podeEditarOcorrencia(oc, '100', mensagens: [{'id_usuario': 100}, {'id_usuario': 7}]), isFalse);
    });

    test('mensagem do porteiro do console (id_usuario nulo) conta como da equipe', () {
      final oc = {'user': 100, 'status': 'Pendente'};
      expect(podeEditarOcorrencia(oc, '100', mensagens: [{'id_usuario': null, 'autor_tipo': 'portaria'}]), isFalse);
    });

    test('só mensagens do próprio autor no chat continua podendo', () {
      final oc = {'user': 100, 'status': 'Pendente'};
      expect(podeEditarOcorrencia(oc, '100', mensagens: [{'id_usuario': 100}, {'id_usuario': '100'}]), isTrue);
      expect(podeEditarOcorrencia(oc, '100', mensagens: []), isTrue);
    });
  });

  group('equipeJaFalouNoChat', () {
    test('lista vazia ou nula não tem equipe', () {
      expect(equipeJaFalouNoChat(null, 100), isFalse);
      expect(equipeJaFalouNoChat([], 100), isFalse);
    });
    test('qualquer mensagem de outro usuário conta', () {
      expect(equipeJaFalouNoChat([{'id_usuario': 5}], 100), isTrue);
    });
    test('item que não é mapa é ignorado', () {
      expect(equipeJaFalouNoChat(['x', 3], 100), isFalse);
    });
  });
}
