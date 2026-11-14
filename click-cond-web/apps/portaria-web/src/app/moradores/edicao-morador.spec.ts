import { payloadEdicaoMorador } from './edicao-morador';
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

  it('não altera o objeto do formulário', () => {
    const novo = { ...base };
    payloadEdicaoMorador(original, novo);
    expect(novo.tag_rfid).toBe('ABC123');
    expect(novo.id_apartamento).toBe(7);
  });
});
