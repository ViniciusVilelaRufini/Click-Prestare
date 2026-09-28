import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

function montar() {
  const segredos = { obter: jest.fn(async (n: string) => (n === 'WA_APP_SECRET' ? 'seg' : n === 'WA_VERIFY_TOKEN' ? 'vt' : undefined)) };
  const inbox = { registrarEntrada: jest.fn(async () => undefined), atualizarStatus: jest.fn(async () => undefined) };
  return { inbox, ctrl: new WhatsappWebhookController(segredos as any, inbox as any) };
}

describe('WhatsappWebhookController', () => {
  it('rotas são públicas (o Meta não tem JWT)', () => {
    const r = new Reflector();
    expect(r.get(IS_PUBLIC_KEY, WhatsappWebhookController.prototype.verificar)).toBe(true);
    expect(r.get(IS_PUBLIC_KEY, WhatsappWebhookController.prototype.receber)).toBe(true);
  });
  it('handshake devolve o challenge com token certo', async () => {
    await expect(montar().ctrl.verificar('subscribe', 'vt', '123')).resolves.toBe('123');
  });
  it('handshake com token errado dá 401', async () => {
    await expect(montar().ctrl.verificar('subscribe', 'x', '123')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('POST sem assinatura válida dá 401', async () => {
    const { ctrl } = montar();
    await expect(ctrl.receber({ rawBody: Buffer.from('{}'), body: {} } as any, 'sha256=00')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('POST assinado processa mensagens', async () => {
    const { ctrl, inbox } = montar();
    const body = { entry: [{ changes: [{ value: { messages: [{ from: '55', id: 'w', timestamp: '1', type: 'text', text: { body: 'Oi' } }] } }] }] };
    const raw = Buffer.from(JSON.stringify(body));
    const sig = 'sha256=' + createHmac('sha256', 'seg').update(raw).digest('hex');
    await ctrl.receber({ rawBody: raw, body } as any, sig);
    expect(inbox.registrarEntrada).toHaveBeenCalledTimes(1);
  });
});
