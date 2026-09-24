import 'package:click/pages/shared/visitantes/new_visitante.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
      'reutilizar um prestador pela área de visitantes mantém o novo cadastro como visitante',
      () {
    expect(
      tipoCadastroVisitante(
          defaultType: 'visitante', isVisitanteExistente: false),
      'visitante',
    );
  });

  test(
      'a área de prestadores preserva o tipo prestador ao reutilizar o cadastro',
      () {
    expect(
      tipoCadastroVisitante(
          defaultType: 'prestador', isVisitanteExistente: true),
      'prestador',
    );
  });
}
