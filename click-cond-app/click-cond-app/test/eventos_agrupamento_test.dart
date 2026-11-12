import 'package:click/utils/eventos_agrupamento.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> ev(int id, DateTime? local) =>
    {'id': id, 'timestamp': local?.toUtc().toIso8601String()};

void main() {
  final agora = DateTime(2026, 11, 11, 15, 30);

  test('hoje e ontem viram HOJE e ONTEM, cada um com sua data', () {
    final g = agruparEventosPorDia([
      ev(1, DateTime(2026, 11, 11, 10)),
      ev(2, DateTime(2026, 11, 11, 8)),
      ev(3, DateTime(2026, 11, 10, 22)),
    ], agora: agora);
    expect(g.length, 2);
    expect(g[0].rotuloEsquerdo, 'HOJE');
    expect(g[0].rotuloDireito, '11 de novembro');
    expect(g[0].eventos.length, 2);
    expect(g[1].rotuloEsquerdo, 'ONTEM');
    expect(g[1].rotuloDireito, '10 de novembro');
  });

  test('dia anterior a ontem usa o dia da semana', () {
    final g = agruparEventosPorDia([ev(1, DateTime(2026, 11, 9, 9))],
        agora: agora);
    expect(g.single.rotuloEsquerdo, 'SEGUNDA');
    expect(g.single.rotuloDireito, '9 de novembro');
  });

  test('virada de ano: 31/12 é ONTEM em 1º de janeiro', () {
    final g = agruparEventosPorDia([
      ev(1, DateTime(2027, 1, 1, 0, 5)),
      ev(2, DateTime(2026, 12, 31, 23, 50)),
      ev(3, DateTime(2026, 12, 30, 12)),
    ], agora: DateTime(2027, 1, 1, 9));
    expect(g.map((e) => e.rotuloEsquerdo), ['HOJE', 'ONTEM', 'QUARTA']);
    expect(g[1].rotuloDireito, '31 de dezembro');
  });

  test('timestamp inválido ou ausente vai num grupo sem cabeçalho, no fim', () {
    final g = agruparEventosPorDia([
      {'id': 1, 'timestamp': 'lixo'},
      ev(2, DateTime(2026, 11, 11, 10)),
      {'id': 3},
    ], agora: agora);
    expect(g.length, 2);
    expect(g[0].rotuloEsquerdo, 'HOJE');
    expect(g[1].rotuloEsquerdo, '');
    expect(g[1].rotuloDireito, '');
    expect(g[1].eventos.length, 2);
  });

  test('limita a 4 linhas no total', () {
    final g = agruparEventosPorDia(
        List.generate(6, (i) => ev(i, DateTime(2026, 11, 11, 10))),
        agora: agora);
    expect(g.single.eventos.length, 4);
  });
}
