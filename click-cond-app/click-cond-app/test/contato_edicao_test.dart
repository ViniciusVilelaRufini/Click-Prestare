import 'package:click/utils/contato_edicao.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('CPF e CNPJ só numéricos ganham máscara; o resto fica', () {
    expect(formatarDocumentoEdicao('45346648852'), '453.466.488-52');
    expect(formatarDocumentoEdicao('12345678000190'), '12.345.678/0001-90');
    expect(formatarDocumentoEdicao('453.466.488-52'), '453.466.488-52');
    expect(formatarDocumentoEdicao('12.345.678-X'), '12.345.678-X');
    expect(formatarDocumentoEdicao(null), '');
  });

  test('telefone com +55, sem DDI ou de 10 dígitos vira máscara brasileira', () {
    expect(formatarTelefoneEdicao('+5517992559990'), '(17) 99255-9990');
    expect(formatarTelefoneEdicao('17992559990'), '(17) 99255-9990');
    expect(formatarTelefoneEdicao('1733221100'), '(17) 3322-1100');
    expect(formatarTelefoneEdicao('12345'), '12345');
    expect(formatarTelefoneEdicao(''), '');
  });

  group('contatoParaEnvio', () {
    test('sem mexer, envia o valor original do servidor', () {
      expect(
        contatoParaEnvio(
            exibido: '(17) 99255-9990',
            original: '+5517992559990',
            formatar: formatarTelefoneEdicao,
            soDigitos: true),
        '+5517992559990',
      );
      expect(
        contatoParaEnvio(
            exibido: '453.466.488-52',
            original: '45346648852',
            formatar: formatarDocumentoEdicao,
            soDigitos: true),
        '45346648852',
      );
    });

    test('editado: tira a máscara se a tela enviava só dígitos', () {
      expect(
        contatoParaEnvio(
            exibido: '(17) 99255-9991',
            original: '+5517992559990',
            formatar: formatarTelefoneEdicao,
            soDigitos: true),
        '17992559991',
      );
    });

    test('editado: mantém o texto quando a tela já enviava com máscara', () {
      expect(
        contatoParaEnvio(
            exibido: '(17) 99255-9991',
            original: '17992559990',
            formatar: formatarTelefoneEdicao),
        '(17) 99255-9991',
      );
    });

    test('RG com letras não é mexido', () {
      expect(
        contatoParaEnvio(
            exibido: '12.345.678-X',
            original: '12345678X',
            formatar: formatarDocumentoEdicao,
            soDigitos: true),
        '12.345.678-X',
      );
    });
  });
}
