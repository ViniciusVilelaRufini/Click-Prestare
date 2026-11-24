import 'package:click/models/vaga_model.dart';
import 'package:flutter_test/flutter_test.dart';

/// C6: o período da vaga era lido em UTC e a tela mostrava o dia UTC — uma
/// vaga até 22h de Brasília (01h UTC) aparecia como "até amanhã".
void main() {
  test('início e fim da vaga ficam no fuso do aparelho', () {
    const fimIso = '2026-11-25T01:00:00.000Z';
    final v = VagaModel.fromJson({
      'tipo_ocupacao': 'visitante',
      'inicio': '2026-11-24T12:00:00.000Z',
      'fim': fimIso,
    });
    expect(v.fim!.isUtc, isFalse);
    expect(v.inicio!.isUtc, isFalse);
    final local = DateTime.parse(fimIso).toLocal();
    expect([v.fim!.day, v.fim!.hour], [local.day, local.hour]);
  });

  test('sem data ou data inválida: null', () {
    final v = VagaModel.fromJson({'tipo_ocupacao': 'proprio', 'inicio': null, 'fim': 'xx'});
    expect(v.inicio, isNull);
    expect(v.fim, isNull);
  });
}
