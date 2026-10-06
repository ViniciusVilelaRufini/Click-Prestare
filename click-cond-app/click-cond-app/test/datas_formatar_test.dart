import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/datas.dart';

/// O detalhe da ocorrência mostrava `created_at`/`resposta_at` crus
/// (`2026-10-05T14:30:00.000Z`). O formato é dd/MM/yyyy HH:mm no fuso do
/// aparelho; o que não for data volta como veio.
void main() {
  String esperado(DateTime d) {
    String p(int n) => n.toString().padLeft(2, '0');
    return '${p(d.day)}/${p(d.month)}/${d.year} ${p(d.hour)}:${p(d.minute)}';
  }

  group('formatarDataHoraCurta', () {
    test('ISO com Z converte para o fuso local', () {
      final local = DateTime.utc(2026, 10, 5, 14, 30).toLocal();
      expect(formatarDataHoraCurta('2026-10-05T14:30:00.000Z'), esperado(local));
    });

    test('ISO sem Z é lido como horário local, sem deslocar', () {
      expect(formatarDataHoraCurta('2026-10-05T14:30:00'), '05/10/2026 14:30');
    });

    test('nulo e vazio viram o fallback', () {
      expect(formatarDataHoraCurta(null), '');
      expect(formatarDataHoraCurta(''), '');
      expect(formatarDataHoraCurta(null, fallback: '-'), '-');
    });

    test('texto inválido volta como veio', () {
      expect(formatarDataHoraCurta('ontem à tarde'), 'ontem à tarde');
    });
  });
}
