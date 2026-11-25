import 'package:click/pages/shared/ocorrencias/ocorrencia_sla.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final agora = DateTime(2026, 11, 25, 12);
  test('prazo vencido e ocorrência em aberto: atrasada', () {
    expect(ocorrenciaAtrasada({'status': 'Pendente', 'prazo': '2026-11-24T10:00:00'}, agora: agora), isTrue);
  });
  test('no prazo, sem prazo ou solucionada: não é atrasada', () {
    expect(ocorrenciaAtrasada({'status': 'Pendente', 'prazo': '2026-11-26T10:00:00'}, agora: agora), isFalse);
    expect(ocorrenciaAtrasada({'status': 'Pendente'}, agora: agora), isFalse);
    expect(ocorrenciaAtrasada({'status': 'Solucionado', 'prazo': '2026-11-24T10:00:00'}, agora: agora), isFalse);
    expect(ocorrenciaAtrasada(null, agora: agora), isFalse);
  });
}
