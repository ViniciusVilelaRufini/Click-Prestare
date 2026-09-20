import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/visitantes_presenca.dart';

void main() {
  group('Permissões de Visitantes para o Porteiro', () {
    test('porteiro/funcionário NÃO pode editar cadastro de visitante existente', () {
      expect(podeEditarVisitante(userType: 'funcionario', canManage: true), isFalse);
      expect(podeEditarVisitante(userType: 'funcionario', canManage: false), isFalse);
    });

    test('morador ou síndico pode editar cadastro se tiver canManage', () {
      expect(podeEditarVisitante(userType: 'sindico', canManage: true), isTrue);
      expect(podeEditarVisitante(userType: 'morador', canManage: true), isTrue);
      expect(podeEditarVisitante(userType: 'morador', canManage: false), isFalse);
    });

    test('porteiro pode registrar entrada e saída de visitante se tiver canManage', () {
      expect(podeRegistrarEntradaSaidaVisitante(canManage: true), isTrue);
      expect(podeRegistrarEntradaSaidaVisitante(canManage: false), isFalse);
    });
  });
}
