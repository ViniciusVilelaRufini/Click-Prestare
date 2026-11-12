import 'package:click/utils/telefone_exibicao.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('formata 11 e 10 dígitos', () {
    expect(formatarTelefoneExibicao('11945700985'), '(11) 94570-0985');
    expect(formatarTelefoneExibicao('1733221100'), '(17) 3322-1100');
  });
  test('mantém o que já vem formatado ou com outro tamanho', () {
    expect(formatarTelefoneExibicao('(17) 98833-8146'), '(17) 98833-8146');
    expect(formatarTelefoneExibicao('12345'), '12345');
    expect(formatarTelefoneExibicao('+5511945700985'), '+5511945700985');
    expect(formatarTelefoneExibicao(''), '');
    expect(formatarTelefoneExibicao(null), '');
  });
}
