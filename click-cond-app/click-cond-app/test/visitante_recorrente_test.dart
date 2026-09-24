import 'package:click/pages/shared/visitantes/new_visitante.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('visitante recorrente preserva os dias sem virar prestador', () {
    final visitante = VisitanteModel(
      nome: 'Visitante recorrente',
      is_visitante: true,
      is_prestador: false,
      dias_semana: diasAcessoSelecionados(['seg', 'ter', 'qua']),
    );

    expect(visitante.toJson()['is_visitante'], isTrue);
    expect(visitante.toJson()['is_prestador'], isFalse);
    expect(visitante.toJson()['dias_semana'], 'seg,ter,qua');
  });

  test('visita avulsa nao envia agenda semanal', () {
    expect(diasAcessoSelecionados([]), isNull);
  });
}
