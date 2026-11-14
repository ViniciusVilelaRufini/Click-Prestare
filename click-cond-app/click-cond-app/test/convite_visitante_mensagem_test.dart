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

  test('com passeUrl: leva o link do passe e o PIN como alternativa, sem qrserver', () {
    const url = 'https://www.prestarecondominios.com.br/?passe=abc.def';
    final message = buildVisitorAccessInvite(
      condominioNome: 'Residencial Boa Vista',
      bloco: 'A',
      apartamento: '106',
      autorizadoPor: 'Vinicius',
      codigo: '460-551',
      passeUrl: url,
    );

    expect(message, contains('🔑 *Código de Acesso (PIN):* 460-551'));
    expect(
      message,
      endsWith('📲 *Passe de acesso (QR):*\n'
          'Abra o link ao chegar e mostre o QR no leitor:\n'
          '$url\n'
          '\n'
          'Se preferir, informe o PIN na portaria.'),
    );
    expect(message, isNot(contains('qrserver')));
  });

  test('sem passeUrl: só o PIN, sem mencionar QR', () {
    final message = buildVisitorAccessInvite(
      condominioNome: 'Residencial Boa Vista',
      bloco: 'A',
      apartamento: '106',
      autorizadoPor: 'Vinicius',
      codigo: '460-551',
    );

    expect(message, endsWith('Informe este código ao chegar na portaria para liberação da sua entrada.'));
    expect(message, isNot(contains('QR')));
    expect(message, isNot(contains('qrserver')));
  });

  test('passeUrl vazio conta como ausente', () {
    final message = buildVisitorAccessInvite(
      condominioNome: 'X',
      bloco: '',
      apartamento: '1',
      autorizadoPor: 'Y',
      codigo: '1',
      passeUrl: '  ',
    );
    expect(message, isNot(contains('QR')));
  });
}
