import { FinanceiroService } from './financeiro.service';
import { textoUnidade } from '../common/rotulo-bloco.util';
import { saudacao } from '../common/saudacao.util';

describe('textos de aviso sem fragmentos vazios', () => {
  it('textoUnidade nunca escreve "Bloco null"', () => {
    expect(textoUnidade('12', null)).toBe('Apto 12');
    expect(textoUnidade('12', '')).toBe('Apto 12');
    expect(textoUnidade('12', 'A')).toBe('Apto 12 Bloco A');
    expect(textoUnidade('12', 'Bloco B')).toBe('Apto 12 Bloco B');
  });

  it('saudacao sem nome vira só "Olá!"', () => {
    expect(saudacao(null)).toBe('Olá!');
    expect(saudacao('  ')).toBe('Olá!');
    expect(saudacao('Ana')).toBe('Olá, Ana!');
  });

  describe('notifyInadimplente', () => {
    function montar(pushRetorno: any, email: string | null = null) {
      const prisma: any = { isConnected: true, users: { findMany: jest.fn(async () => [{ name: 'Ana', fcm_token: 'tok', email }]) } };
      const notifications = { sendPushNotification: jest.fn(async () => pushRetorno) };
      const mail = { sendBillingReminder: jest.fn(async () => undefined) };
      const tenant = { assertCondominio: jest.fn(async () => undefined) };
      const svc: any = new FinanceiroService(prisma, {} as any, mail as any, notifications as any, {} as any, {} as any, tenant as any);
      jest.spyOn(svc, 'getInadimplenteDetail').mockResolvedValue([{ valor: 100, atrasado: true, nome: 'Fatura', data_vencimento: new Date() }]);
      jest.spyOn(svc, 'whereUsuariosDaUnidade').mockReturnValue({});
      return { svc, notifications };
    }

    it('push singular e unidade sem bloco no texto', async () => {
      const { svc, notifications } = montar('msg-id');
      const r = await svc.notifyInadimplente(1, '12', '');
      expect((notifications.sendPushNotification.mock.calls[0] as any[])[2]).toMatch(/^Constatamos 1 fatura pendente para o Apto 12, totalizando /);
      expect(r.pushEnviados).toBe(1);
    });

    it('push que não saiu (retorna null) não conta como enviado', async () => {
      const { svc } = montar(null);
      const r = await svc.notifyInadimplente(1, '12', 'A');
      expect(r.success).toBe(false);
      expect(r.pushEnviados).toBe(0);
    });
  });
});
