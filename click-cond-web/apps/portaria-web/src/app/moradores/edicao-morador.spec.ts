import { ajusteMenorDeIdade, confirmacaoEnviarAcesso, payloadCadastroMorador, payloadEdicaoMorador } from './edicao-morador';
import type { CreateMorador } from './moradores.service';

const base: CreateMorador = {
  nome: 'Ana',
  telefone: '(11) 99999-0000',
  id_apartamento: 7,
  tag_rfid: 'ABC123',
  qrcode_acesso: 'QR-9',
};
const original = { id_apartamento: 7, tag_rfid: 'ABC123', qrcode_acesso: 'QR-9' };

describe('payloadEdicaoMorador', () => {
  it('não reenvia tag, QR nem unidade que o operador não mudou', () => {
    const p = payloadEdicaoMorador(original, { ...base, telefone: '(11) 98888-0000' });
    expect(p).not.toHaveProperty('tag_rfid');
    expect(p).not.toHaveProperty('qrcode_acesso');
    expect(p).not.toHaveProperty('id_apartamento');
    expect(p).not.toHaveProperty('id_apartamento_anterior');
    expect(p.telefone).toBe('(11) 98888-0000');
  });

  it('cadastro sem tag e sem QR: os campos vazios do formulário não vão', () => {
    const p = payloadEdicaoMorador(
      { id_apartamento: 7, tag_rfid: null, qrcode_acesso: null },
      { ...base, tag_rfid: '', qrcode_acesso: '' },
    );
    expect(p).not.toHaveProperty('tag_rfid');
    expect(p).not.toHaveProperty('qrcode_acesso');
  });

  it('tag e QR alterados vão, inclusive apagados', () => {
    const p = payloadEdicaoMorador(original, { ...base, tag_rfid: 'NOVA1', qrcode_acesso: '' });
    expect(p.tag_rfid).toBe('NOVA1');
    expect(p.qrcode_acesso).toBe('');
  });

  it('unidade trocada vai junto com a unidade que saiu', () => {
    const p = payloadEdicaoMorador(original, { ...base, id_apartamento: 9 });
    expect(p.id_apartamento).toBe(9);
    expect(p.id_apartamento_anterior).toBe(7);
  });

  it('unidade vinda do select como texto conta como a mesma', () => {
    const p = payloadEdicaoMorador(original, { ...base, id_apartamento: '7' as any });
    expect(p).not.toHaveProperty('id_apartamento');
  });

  it('tipo que não mudou não vai (a API aplicaria ao vínculo)', () => {
    const p = payloadEdicaoMorador({ ...original, tipo: 'Proprietário' }, { ...base, tipo: 'proprietario' });
    expect(p).not.toHaveProperty('tipo');
  });

  it('tipo alterado vai', () => {
    const p = payloadEdicaoMorador({ ...original, tipo: 'proprietario' }, { ...base, tipo: 'inquilino' });
    expect(p.tipo).toBe('inquilino');
  });

  it('e-mail, foto e nascimento que vieram do cadastro não são reenviados', () => {
    const p = payloadEdicaoMorador(
      { ...original, email: 'ana@x.com', foto_pessoa: 'https://b/f.jpg', foto_documento: null, data_nascimento: '1980-04-19' },
      { ...base, email: 'ana@x.com', foto_pessoa: 'https://b/f.jpg', data_nascimento: '1980-04-19', sendCredentials: false, telefone: '(11) 98888-0000' },
    );
    expect(p).not.toHaveProperty('email');
    expect(p).not.toHaveProperty('foto_pessoa');
    expect(p).not.toHaveProperty('foto_documento');
    expect(p).not.toHaveProperty('data_nascimento');
    expect(p).not.toHaveProperty('sendCredentials');
    expect(p.telefone).toBe('(11) 98888-0000');
  });

  it('foto removida, foto nova, e-mail e nascimento alterados vão', () => {
    const orig = { ...original, email: 'ana@x.com', foto_pessoa: 'https://b/f.jpg', data_nascimento: '' };
    expect(payloadEdicaoMorador(orig, { ...base, email: 'ana@x.com', foto_pessoa: '' }).foto_pessoa).toBe('');
    expect(payloadEdicaoMorador(orig, { ...base, foto_pessoa: 'data:image/jpeg;base64,AAA' }).foto_pessoa).toBe('data:image/jpeg;base64,AAA');
    expect(payloadEdicaoMorador(orig, { ...base, email: 'nova@x.com' }).email).toBe('nova@x.com');
    expect(payloadEdicaoMorador(orig, { ...base, data_nascimento: '1990-01-02' }).data_nascimento).toBe('1990-01-02');
  });

  it('não altera o objeto do formulário', () => {
    const novo = { ...base };
    payloadEdicaoMorador(original, novo);
    expect(novo.tag_rfid).toBe('ABC123');
    expect(novo.id_apartamento).toBe(7);
  });
});

describe('payloadCadastroMorador', () => {
  it('sem e-mail não pede o envio de credenciais, mesmo com a caixa marcada', () => {
    expect(payloadCadastroMorador({ nome: 'Ana', id_apartamento: 7, email: '  ', sendCredentials: true }).sendCredentials).toBe(false);
  });

  it('com e-mail mantém a escolha do operador', () => {
    expect(payloadCadastroMorador({ nome: 'Ana', id_apartamento: 7, email: 'a@b.com', sendCredentials: true }).sendCredentials).toBe(true);
    expect(payloadCadastroMorador({ nome: 'Ana', id_apartamento: 7, email: 'a@b.com', sendCredentials: false }).sendCredentials).toBe(false);
  });
});

describe('ajusteMenorDeIdade (B4)', () => {
  const menor: CreateMorador = { nome: 'Bia', id_apartamento: 7, tipo: 'inquilino', email: 'bia@x.com', foto_pessoa: 'https://b/f.jpg' };

  it('edição: não força dependente nem apaga o e-mail, e sem foto nova não avisa', () => {
    const r = ajusteMenorDeIdade(menor, true, 'https://b/f.jpg');
    expect(r.ajuste).toEqual({});
    expect(r.aviso).toBeNull();
  });

  it('edição com foto nova: avisa pela regra do termo do responsável, sem dizer que a foto não vai', () => {
    const r = ajusteMenorDeIdade({ ...menor, foto_pessoa: 'data:image/jpeg;base64,AAA' }, true, 'https://b/f.jpg');
    expect(r.aviso).toContain('termo');
    expect(r.aviso).not.toContain('NÃO será sincronizada');
    expect(r.ajuste).toEqual({});
  });

  it('cadastro novo: sai como dependente, sem foto, sem e-mail e sem credenciais', () => {
    const r = ajusteMenorDeIdade(menor, false);
    expect(r.ajuste).toEqual({ foto_pessoa: undefined, sendCredentials: false, tipo: 'dependente', email: '' });
    expect(r.aviso).toBeTruthy();
  });
});

describe('confirmacaoEnviarAcesso (M5)', () => {
  it('quem já tem conta no app é avisado de que a senha atual cai e as sessões saem', () => {
    const c = confirmacaoEnviarAcesso({ email: 'a@x.com', tem_conta_app: true });
    expect(c.message).toContain('senha atual deixa de funcionar');
    expect(c.message).toContain('todos os aparelhos');
    expect(c.variant).toBe('danger');
  });

  it('sem conta, segue o texto da senha inicial', () => {
    const c = confirmacaoEnviarAcesso({ email: 'a@x.com', tem_conta_app: false });
    expect(c.message).toContain('senha inicial');
    expect(c.variant).toBe('primary');
  });
});
