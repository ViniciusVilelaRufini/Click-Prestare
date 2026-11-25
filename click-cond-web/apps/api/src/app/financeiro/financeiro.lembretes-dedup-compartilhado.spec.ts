process.env.TZ = 'UTC';

import { hojeBrasilia } from '../common/hora-brasilia.util';
import { FinanceiroService } from './financeiro.service';

/**
 * J3, J4 e J5 da revisão dos ciclos (jobs) da API.
 *
 * J3: o dedup dos lembretes e da régua de WhatsApp era um Set do processo. Um
 * deploy no meio do job (ciclo do dia ainda não marcado) deixava a instância
 * nova, com o Set vazio, reenviar tudo dentro da mesma janela das 9h-12h.
 * Agora a marca fatura+tipo+dia vai para estado_compartilhado ANTES de enviar.
 *
 * J4: os três passos rodavam num try só; exceção no 1º pulava a régua e o dia
 * era marcado. Agora cada passo tem o seu try e o dia só é marcado se todos
 * rodaram.
 *
 * J5: a régua extraía a unidade com o regex antigo "Apto X Bloco Y" e
 * igualdade estrita em Moradores; fatura sem bloco nunca recebia aviso.
 */

/** Tabela estado_compartilhado falsa, compartilhada entre "instâncias". */
function tabelaEstado() {
  const linhas = new Map<string, any>();
  const ordem: string[] = [];
  return {
    ordem,
    linhas,
    findUnique: jest.fn(async ({ where }: any) => linhas.get(where.chave) ?? null),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (const [k, l] of linhas) {
        const casaChave = where.chave ? k === where.chave : true;
        const venceu = where.expira_em?.lte ? l.expira_em <= where.expira_em.lte : true;
        if (casaChave && venceu) {
          linhas.delete(k);
          count++;
        }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: any) => {
      if (linhas.has(data.chave)) throw Object.assign(new Error('Unique'), { code: 'P2002' });
      linhas.set(data.chave, { ...data });
      ordem.push(`marca:${data.chave}`);
      return data;
    }),
    upsert: jest.fn(async ({ where, create }: any) => {
      linhas.set(where.chave, { ...create });
      return create;
    }),
  };
}

function diasAPartirDeHoje(n: number): Date {
  const d = hojeBrasilia();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

describe('Financeiro — lembretes com dedup compartilhado (J3)', () => {
  function instancia(estado: any, fatura: any) {
    const prisma: any = {
      isConnected: true,
      estado_Compartilhado: estado,
      financeiro: { findMany: jest.fn(async () => [fatura]) },
      apartamentos: { findMany: jest.fn(async () => [{ apto: '5', bloco: null }]) },
      users: { findMany: jest.fn(async () => [{ fcm_token: 'tok', email: 'm@x.com', name: 'Fulano' }]) },
    };
    const mail = { sendBillingReminder: jest.fn(async () => { estado.ordem.push('email'); }) };
    const notifications = { sendPushNotification: jest.fn(async () => { estado.ordem.push('push'); }) };
    const svc: any = new FinanceiroService(
      prisma, {} as any, mail as any, notifications as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, mail, notifications };
  }

  it('a marca é gravada antes do envio, e a instância nova (pós-deploy) não reenvia', async () => {
    const estado = tabelaEstado();
    const fatura = { id: 31, nome: 'Apto 5 - Ref. 08/2026', valor: 50, data_vencimento: diasAPartirDeHoje(5), id_condominio: 7, pix_copia_cola: '' };

    const a = instancia(estado, fatura);
    const s1 = await a.svc.runBillingRemindersJob();
    expect(s1.emailsEnviados).toBe(1);
    expect(estado.ordem[0]).toMatch(/^marca:.*31.*antecipado/);
    expect(estado.ordem.slice(1)).toEqual(['push', 'email']);

    // Deploy: processo novo, memória vazia, mesmo banco.
    const b = instancia(estado, fatura);
    const s2 = await b.svc.runBillingRemindersJob();
    expect(s2.deduplicados).toBe(1);
    expect(b.mail.sendBillingReminder).not.toHaveBeenCalled();
    expect(b.notifications.sendPushNotification).not.toHaveBeenCalled();
  });
});

describe('Financeiro — régua de cobrança WhatsApp (J3 + J5)', () => {
  function instancia(estado: any, fatura: any, aptos: any[]) {
    const usersFindMany = jest.fn(async (_args?: any) => [{ name: 'Fulano', phone: '(17) 99999-0000' }]);
    const prisma: any = {
      isConnected: true,
      estado_Compartilhado: estado,
      condominios: {
        findMany: jest.fn(async () => [
          { id: 7, nome: 'Cond', dias_atraso_aviso_1: 3, dias_atraso_aviso_2: 10, dias_atraso_aviso_3: 20 },
        ]),
      },
      financeiro: { findMany: jest.fn(async () => [fatura]) },
      apartamentos: { findMany: jest.fn(async () => aptos) },
      users: { findMany: usersFindMany },
    };
    const notifications = { sendWhatsApp: jest.fn(async () => { estado.ordem.push('whats'); }) };
    const svc: any = new FinanceiroService(
      prisma, {} as any, {} as any, notifications as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, notifications, usersFindMany };
  }

  it('fatura SEM bloco recebe o aviso, pelos dois vínculos da unidade', async () => {
    const estado = tabelaEstado();
    const fatura = { id: 40, nome: 'Apto 5 - Ref. 08/2026', valor: 80, data_vencimento: diasAPartirDeHoje(-3), pix_copia_cola: null };
    const { svc, notifications, usersFindMany } = instancia(estado, fatura, [{ apto: '5', bloco: null }]);

    await svc.runAutoWhatsAppDunningJob();

    expect(notifications.sendWhatsApp).toHaveBeenCalledTimes(1);
    const where = JSON.stringify(usersFindMany.mock.calls[0][0].where);
    expect(where).toContain('apartamentosUsers');
    expect(where).toContain('moradores');
  });

  it('marca antes do WhatsApp e a instância nova não reenvia o mesmo aviso', async () => {
    const estado = tabelaEstado();
    const fatura = { id: 41, nome: 'Apto 1 Bloco A - Ref. 08/2026', valor: 80, data_vencimento: diasAPartirDeHoje(-3), pix_copia_cola: null };

    const a = instancia(estado, fatura, [{ apto: '1', bloco: 'A' }]);
    await a.svc.runAutoWhatsAppDunningJob();
    expect(a.notifications.sendWhatsApp).toHaveBeenCalledTimes(1);
    expect(estado.ordem[0]).toMatch(/^marca:.*41.*aviso_1/);
    expect(estado.ordem[1]).toBe('whats');

    const b = instancia(estado, fatura, [{ apto: '1', bloco: 'A' }]);
    await b.svc.runAutoWhatsAppDunningJob();
    expect(b.notifications.sendWhatsApp).not.toHaveBeenCalled();
  });
});

describe('Financeiro — tickBillingJob, um try por passo (J4)', () => {
  const env = process.env['BILLING_REMINDER_HOUR'];
  afterEach(() => {
    jest.useRealTimers();
    if (env === undefined) delete process.env['BILLING_REMINDER_HOUR'];
    else process.env['BILLING_REMINDER_HOUR'] = env;
  });

  function servico() {
    const svc: any = Object.create(FinanceiroService.prototype);
    svc.billingJobRunning = false;
    svc.logger = { debug: jest.fn(), error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    svc.runBillingRemindersJob = jest.fn(async () => undefined);
    svc.runRecurringBillingJob = jest.fn(async () => undefined);
    svc.runAutoWhatsAppDunningJob = jest.fn(async () => undefined);
    return svc;
  }

  beforeEach(() => {
    process.env['BILLING_REMINDER_HOUR'] = '9';
    jest.useFakeTimers({ now: new Date('2026-09-23T13:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
  });

  it('exceção no passo 1 não pula a recorrência nem a régua, e o dia NÃO é marcado', async () => {
    const svc = servico();
    svc.runBillingRemindersJob.mockRejectedValue(new Error('findMany timeout'));
    expect(await svc.tickBillingJob()).toBe(false);
    expect(svc.runRecurringBillingJob).toHaveBeenCalled();
    expect(svc.runAutoWhatsAppDunningJob).toHaveBeenCalled();
    expect(svc.billingJobRunning).toBe(false);
  });

  it('exceção na régua (passo 3) também deixa o dia sem marca', async () => {
    const svc = servico();
    svc.runAutoWhatsAppDunningJob.mockRejectedValue(new Error('x'));
    expect(await svc.tickBillingJob()).toBe(false);
  });

  it('os três passos sem exceção marcam o dia', async () => {
    const svc = servico();
    expect(await svc.tickBillingJob()).toBe(true);
  });
});
