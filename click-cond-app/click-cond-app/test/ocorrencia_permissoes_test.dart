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
  });
}
