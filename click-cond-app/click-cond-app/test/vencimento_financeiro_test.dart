import 'package:flutter_test/flutter_test.dart';
import 'package:click/utils/vencimento_financeiro.dart';

void main() {
  final hoje = DateTime(2026, 11, 11, 15, 30);

  Map<String, dynamic> conta(String v, {dynamic pago = 0}) =>
      {'pago': pago, 'data_vencimento': v};

  test('vencimento passado vira "Vencido desde"', () {
    final r = proximoVencimentoPendente([conta('07/11/2026')], hoje: hoje)!;
    expect(r.rotulo, 'Vencido desde 07/11');
    expect(r.situacao, SituacaoVencimento.vencido);
  });

  test('vencimento hoje vira "Vence hoje"', () {
    final r = proximoVencimentoPendente([conta('11/11/2026')], hoje: hoje)!;
    expect(r.rotulo, 'Vence hoje');
    expect(r.situacao, SituacaoVencimento.hoje);
  });

  test('vencimento futuro vira "Vence dd/MM"', () {
    final r = proximoVencimentoPendente([conta('20/11/2026')], hoje: hoje)!;
    expect(r.rotulo, 'Vence 20/11');
    expect(r.situacao, SituacaoVencimento.futuro);
  });

  test('vencido de outro ano mostra o ano', () {
    final r = proximoVencimentoPendente([conta('15/12/2025')], hoje: hoje)!;
    expect(r.rotulo, 'Vencido desde 15/12/2025');
  });

  test('vencimento futuro de outro ano mostra o ano', () {
    final r = proximoVencimentoPendente([conta('05/01/2027')], hoje: hoje)!;
    expect(r.rotulo, 'Vence 05/01/2027');
    expect(r.situacao, SituacaoVencimento.futuro);
  });

  test('aceita yyyy-MM-dd e yyyy-MM-ddTHH:mm:ss', () {
    expect(proximoVencimentoPendente([conta('2026-11-07')], hoje: hoje)!.rotulo,
        'Vencido desde 07/11');
    expect(
        proximoVencimentoPendente([conta('2026-11-25T00:00:00.000Z')], hoje: hoje)!
            .rotulo,
        'Vence 25/11');
  });

  test('pega a menor data entre as pendentes e ignora as pagas', () {
    final r = proximoVencimentoPendente([
      conta('01/11/2026', pago: 1),
      conta('20/11/2026'),
      conta('05/11/2026'),
    ], hoje: hoje)!;
    expect(r.rotulo, 'Vencido desde 05/11');
  });

  test('vazio ou sem data retorna nulo', () {
    expect(proximoVencimentoPendente([], hoje: hoje), isNull);
    expect(proximoVencimentoPendente([conta('')], hoje: hoje), isNull);
  });
}
