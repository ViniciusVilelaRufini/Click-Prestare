import 'package:click/utils/codigo_dinamico.dart';
import 'package:flutter_test/flutter_test.dart';

// Os mesmos vetores de click-cond-web/apps/api/src/app/credenciais/
// codigo-dinamico.util.spec.ts. Se um lado mudar, o outro quebra aqui.
const hexA = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const hexB = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

void main() {
  final a = segredoDeHex(hexA);
  final b = segredoDeHex(hexB);

  final vetores = <(int, int, List<int>, String)>[
    (1, 0, a, 'P1AAAAAAIAAAAABALZ4WDJKZ4FNI'),
    (1, 59000000, a, 'P1AAAAAAIDQRCMABTQCSPWDO5F3Q'),
    (1, 59000001, a, 'P1AAAAAAIDQRCMDS3DSX2WSX2IVM'),
    (4294967295, 59000000, a, 'P1777777YDQRCMBFJSPWOFKGKEXQ'),
    (123456, 59461234, b, 'P1AAA6EQADRNHHENRPXWQLO4XSOQ'),
  ];

  for (final (id, contador, segredo, esperado) in vetores) {
    test('gera o vetor id=$id contador=$contador', () {
      final codigo = gerarCodigoDinamico(id: id, contador: contador, segredo: segredo);
      expect(codigo, esperado);
      expect(codigo.length, 28);
    });
  }

  test('segredoDeHex lê 32 bytes, maiúsculas ou minúsculas', () {
    expect(a.length, 32);
    expect(a.first, 0);
    expect(a.last, 0x1f);
    expect(segredoDeHex(hexB.toUpperCase()), b);
  });

  test('segredoDeHex recusa hex inválido', () {
    expect(() => segredoDeHex('abc'), throwsFormatException);
    expect(() => segredoDeHex('zz'), throwsFormatException);
  });

  test('contadorDe', () {
    expect(contadorDe(DateTime.fromMillisecondsSinceEpoch(1794614400000, isUtc: true)), 59820480);
    // Fuso não muda o contador: é o mesmo instante.
    expect(contadorDe(DateTime.fromMillisecondsSinceEpoch(1794614400000)), 59820480);
    expect(contadorDe(DateTime.fromMillisecondsSinceEpoch(1794614429999, isUtc: true)), 59820480);
    expect(contadorDe(DateTime.fromMillisecondsSinceEpoch(1794614430000, isUtc: true)), 59820481);
  });

  test('segundosAteTrocar: :00 → 30, :29 → 1, :30 → 30', () {
    final base = DateTime.utc(2026, 11, 14, 10, 0, 0);
    expect(segundosAteTrocar(base), 30);
    expect(segundosAteTrocar(base.add(const Duration(seconds: 29))), 1);
    expect(segundosAteTrocar(base.add(const Duration(seconds: 30))), 30);
    expect(segundosAteTrocar(base.add(const Duration(seconds: 29, milliseconds: 999))), 1);
    expect(segundosAteTrocar(base.add(const Duration(milliseconds: 1))), 30);
    expect(segundosAteTrocar(base.add(const Duration(seconds: 15))), 15);
  });
}
