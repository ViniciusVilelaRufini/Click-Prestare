import { createHmac } from 'crypto';
import { assinaturaValida, interpretarWebhook, janelaAberta, statusAvanca } from './whatsapp-puro';

describe('assinaturaValida', () => {
  const corpo = Buffer.from('{"a":1}');
  const assinar = (s: string) => 'sha256=' + createHmac('sha256', s).update(corpo).digest('hex');
  it('aceita HMAC correto', () => expect(assinaturaValida(corpo, assinar('seg'), 'seg')).toBe(true));
  it('recusa segredo errado', () => expect(assinaturaValida(corpo, assinar('outro'), 'seg')).toBe(false));
  it('recusa sem cabeçalho, corpo ou segredo', () => {
    expect(assinaturaValida(corpo, undefined, 'seg')).toBe(false);
    expect(assinaturaValida(undefined, assinar('seg'), 'seg')).toBe(false);
    expect(assinaturaValida(corpo, assinar('seg'), undefined)).toBe(false);
  });
});

describe('interpretarWebhook', () => {
  const env = (value: any) => ({ entry: [{ changes: [{ field: 'messages', value }] }] });
  it('texto com nome do perfil', () => {
    const r = interpretarWebhook(env({
      contacts: [{ wa_id: '5521999369814', profile: { name: 'Ana' } }],
      messages: [{ from: '5521999369814', id: 'wamid.1', timestamp: '1790600000', type: 'text', text: { body: 'Oi' } }],
    }));
    expect(r.mensagens).toEqual([{ wamid: 'wamid.1', waId: '5521999369814', nomePerfil: 'Ana', tipo: 'text', texto: 'Oi', em: new Date(1790600000 * 1000) }]);
  });
  it('mídia vira marcador', () => {
    const r = interpretarWebhook(env({ messages: [{ from: '55', id: 'w2', timestamp: '1', type: 'audio', audio: {} }] }));
    expect(r.mensagens[0].texto).toBe('[áudio recebido]');
  });
  it('status traduzido, com erro', () => {
    const r = interpretarWebhook(env({ statuses: [
      { id: 'w3', status: 'delivered' },
      { id: 'w4', status: 'failed', errors: [{ title: 'Re-engagement message' }] },
    ] }));
    expect(r.status).toEqual([{ wamid: 'w3', status: 'entregue' }, { wamid: 'w4', status: 'falhou', erro: 'Re-engagement message' }]);
  });
  it('corpo estranho não quebra', () => expect(interpretarWebhook(null)).toEqual({ mensagens: [], status: [] }));
});

describe('janelaAberta', () => {
  const agora = new Date('2026-09-28T12:00:00Z');
  it('23h atrás aberta', () => expect(janelaAberta(new Date('2026-09-27T13:00:00Z'), agora)).toBe(true));
  it('25h atrás fechada', () => expect(janelaAberta(new Date('2026-09-27T11:00:00Z'), agora)).toBe(false));
  it('sem mensagem do cliente fechada', () => expect(janelaAberta(null, agora)).toBe(false));
});

describe('statusAvanca', () => {
  it('só para frente', () => {
    expect(statusAvanca('enviada', 'entregue')).toBe(true);
    expect(statusAvanca('lida', 'entregue')).toBe(false);
    expect(statusAvanca('lida', 'falhou')).toBe(false);
    expect(statusAvanca('enviada', 'falhou')).toBe(true);
  });
});
