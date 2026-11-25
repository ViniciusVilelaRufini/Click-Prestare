import { cortar, mascararDocumento, mascararTelefone, redigirSegredos, serializarDetalhes } from './auditoria-redacao.util';

/**
 * Produção (até 15/11): detalhes com "documento":"45346648852" — CPF inteiro legível por qualquer
 * operador do condomínio no Log de Auditoria.
 */
describe('auditoria-redacao — documento e telefone', () => {
  it('mascara CPF mantendo só os 4 últimos dígitos', () => {
    expect(mascararDocumento('45346648852')).toBe('***.***.*88-52');
    expect(mascararDocumento('453.466.488-52')).toBe('***.***.*88-52');
  });

  it('documento curto ou sem dígitos não vaza', () => {
    expect(mascararDocumento('MG-12.345.678')).toBe('***5678');
    expect(mascararDocumento('12345')).toBe('***45');
    expect(mascararDocumento('abc')).toBe('***');
  });

  it('mascara telefone', () => {
    expect(mascararTelefone('(17) 99660-8148')).toBe('(**) *****-8148');
    expect(mascararTelefone('5517996608148')).toBe('(**) *****-8148');
    expect(mascararTelefone('996608')).toBe('***6608');
    expect(mascararTelefone('12')).toBe('***');
  });

  it('redigirSegredos mascara as chaves de documento e telefone (snake e camelCase, qualquer caixa)', () => {
    const r: any = redigirSegredos({
      cpf: '45346648852',
      documento: '45346648852',
      doc: '45346648852',
      doc_identificacao: '45346648852',
      docIdentificacao: '45346648852',
      RG: '123456789',
      telefone: '17996608148',
      celular: '17996608148',
      whatsapp: '17996608148',
      telefoneContato: '17996608148',
      aninhado: { visitante: { Documento: '45346648852' } },
      lista: [{ cpf: '45346648852' }],
    });
    const json = JSON.stringify(r);
    expect(json).not.toContain('45346648852');
    expect(json).not.toContain('17996608148');
    expect(json).not.toContain('123456789');
    expect(r.cpf).toBe('***.***.*88-52');
    expect(r.docIdentificacao).toBe('***.***.*88-52');
    expect(r.RG).toBe('***6789');
    expect(r.telefone).toBe('(**) *****-8148');
    expect(r.telefoneContato).toBe('(**) *****-8148');
    expect(r.aninhado.visitante.Documento).toBe('***.***.*88-52');
    expect(r.lista[0].cpf).toBe('***.***.*88-52');
  });

  it('valor não-string passa inalterado; tipo_documento não é mascarado', () => {
    const r: any = redigirSegredos({ whatsapp: true, telefone: null, cpf: 12, tipo_documento: 'CPF' });
    expect(r).toEqual({ whatsapp: true, telefone: null, cpf: 12, tipo_documento: 'CPF' });
  });

  it('omite data de nascimento', () => {
    const r: any = redigirSegredos({ data_nascimento: '1990-01-01', dataNascimento: '1990-01-01', nome: 'Ana' });
    expect(r).toEqual({ nome: 'Ana' });
  });

  it('continua omitindo segredos', () => {
    const r: any = redigirSegredos({ senha: 'x', token: 'y', nome: 'ok' });
    expect(r).toEqual({ nome: 'ok' });
  });
});

describe('auditoria-redacao — limites', () => {
  it('serializarDetalhes não lança com referência circular', () => {
    const a: any = { x: 1 };
    a.eu = a;
    expect(() => JSON.parse(serializarDetalhes(a))).not.toThrow();
  });

  it('cortar respeita o limite e preserva null', () => {
    expect(cortar('x'.repeat(300), 255)).toHaveLength(255);
    expect(cortar('abc', 255)).toBe('abc');
    expect(cortar(undefined, 10)).toBeNull();
  });
});

/**
 * Revisão da onda final: moradores.service grava detalhes.changes = { documento: {de, para}, ... }.
 * A máscara só olhava valor string direto na chave, então o diff passava inteiro.
 */
describe('auditoria-redacao — diff {de, para} e credenciais', () => {
  const diffReal = {
    contexto: { apartamento: { label: 'Bloco A - 101' } },
    changes: {
      nome: { de: 'Ana', para: 'Ana Maria' },
      documento: { de: '45346648852', para: '12345678909' },
      telefone: { de: '17996608148', para: '(17) 98888-7777' },
      tag_rfid: { de: 'A1B2C3D4', para: 'E5F6A7B8' },
      qrcode_acesso: { de: 'QR-ANTIGO-999', para: 'QR-NOVO-888' },
      foto_pessoa: { de: '(anterior)', para: '(nova)' },
    },
  };

  it('mascara todas as folhas string sob chave de documento/telefone', () => {
    const r: any = redigirSegredos(diffReal);
    const json = JSON.stringify(r);
    for (const cru of ['45346648852', '12345678909', '17996608148', '98888-7777', 'A1B2C3D4', 'E5F6A7B8', 'QR-ANTIGO', 'QR-NOVO']) {
      expect(json).not.toContain(cru);
    }
    expect(r.changes.documento).toEqual({ de: '***.***.*88-52', para: '***.***.*89-09' });
    expect(r.changes.telefone).toEqual({ de: '(**) *****-8148', para: '(**) *****-7777' });
    expect(r.changes.nome).toEqual({ de: 'Ana', para: 'Ana Maria' });
    expect(r.changes).not.toHaveProperty('tag_rfid');
    expect(r.changes).not.toHaveProperty('qrcode_acesso');
    expect(r.contexto.apartamento.label).toBe('Bloco A - 101');
  });

  it('mascara arrays e objetos aninhados sob chave de documento; null continua null', () => {
    const r: any = redigirSegredos({ cpf: ['45346648852', { valor: '12345678909' }], telefone: { de: null, para: '17996608148' } });
    expect(r.cpf).toEqual(['***.***.*88-52', { valor: '***.***.*89-09' }]);
    expect(r.telefone).toEqual({ de: null, para: '(**) *****-8148' });
  });

  it('omite qrcode, qrcode_acesso, tag_rfid, codigo e codigo_validacao (credenciais)', () => {
    const r: any = redigirSegredos({
      qrcode: 'x1',
      qrcode_acesso: 'x2',
      qrCodeAcesso: 'x3',
      tag_rfid: 'x4',
      tagRfid: 'x5',
      codigo: 'x6',
      codigo_validacao: 'x7',
      codigoValidacao: 'x8',
      codigo_rastreio: 'BR123456789',
      nome: 'ok',
    });
    expect(r).toEqual({ codigo_rastreio: 'BR123456789', nome: 'ok' });
  });

  it('mantém codigo_rastreio de encomenda (não é credencial)', () => {
    const r: any = redigirSegredos({ changes: { codigo_rastreio: { de: 'AA1', para: 'BB2' } } });
    expect(r.changes.codigo_rastreio).toEqual({ de: 'AA1', para: 'BB2' });
  });
});
