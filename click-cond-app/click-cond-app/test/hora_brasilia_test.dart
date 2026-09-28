import 'package:click/utils/hora_brasilia.dart';
import 'package:flutter_test/flutter_test.dart';

/// O padrão "agora" do seletor de visita usava o relógio do aparelho: com o
/// celular fora do fuso de Brasília a janela saía deslocada.
void main() {
  test('agora no relógio de Brasília, independente do fuso do aparelho', () {
    final r = agoraBrasilia(DateTime.utc(2026, 9, 28, 19, 12));
    expect([r.year, r.month, r.day, r.hour, r.minute], [2026, 9, 28, 16, 12]);
    expect(r.isUtc, isFalse);
  });

  test('vira o dia quando precisa', () {
    final r = agoraBrasilia(DateTime.utc(2026, 9, 29, 1, 30));
    expect([r.day, r.hour, r.minute], [28, 22, 30]);
  });
}
