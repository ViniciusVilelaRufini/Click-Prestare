import 'package:click/utils/access_invite_message.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('identifica Prestare e o condominio no convite de visitante', () {
    final message = buildVisitorAccessInvite(
      condominioNome: 'Residencial Boa Vista',
      bloco: 'A',
      apartamento: '106',
      autorizadoPor: 'Vinicius',
      codigo: '460-551',
    );

    expect(message, contains('Convite de Acesso - Prestare'));
    expect(message, contains('*Condom\u00EDnio:* Residencial Boa Vista'));
    expect(message, isNot(contains('Click Portaria')));
  });

  test('usa identificacao neutra quando o nome do condominio nao carregou', () {
    final message = buildVisitorAccessInvite(
      condominioNome: '  ',
      bloco: 'A',
      apartamento: '106',
      autorizadoPor: '',
      codigo: '460-551',
    );

    expect(message, contains('*Condom\u00EDnio:* Condominio'));
    expect(message, contains('*Autorizado por:* Morador'));
  });
}
