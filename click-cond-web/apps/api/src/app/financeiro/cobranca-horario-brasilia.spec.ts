// O servidor (Elastic Beanstalk) roda em UTC; o teste força o mesmo fuso.
process.env.TZ = 'UTC';

import { FinanceiroService } from './financeiro.service';
import { hojeBrasilia, horaBrasilia } from '../common/hora-brasilia.util';

/**
 * Os jobs de cobrança (lembretes, recorrência, WhatsApp) só rodam quando a
 * hora bate com BILLING_REMINDER_HOUR (padrão 9). Comparando com a hora do
 * servidor (UTC), disparavam às 06:00 de Brasília — mensagem de cobrança de
 * madrugada para o morador. E "hoje" em UTC marca como vencida, entre 21h e
 * meia-noite de Brasília, a conta que vence no próprio dia.
 */
describe('cobrança no horário de Brasília', () => {
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
    svc.purgarCacheLembretesAntigos = jest.fn();
    svc.runBillingRemindersJob = jest.fn(async () => undefined);
    svc.runRecurringBillingJob = jest.fn(async () => undefined);
    svc.runAutoWhatsAppDunningJob = jest.fn(async () => undefined);
    return svc;
  }

  it('às 06:00 de Brasília (09:00 UTC) o job das 9h NÃO roda', async () => {
    process.env['BILLING_REMINDER_HOUR'] = '9';
    jest.useFakeTimers({ now: new Date('2026-09-23T09:10:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const svc = servico();
    await svc.tickBillingJob();
    expect(svc.runBillingRemindersJob).not.toHaveBeenCalled();
  });

  it('às 09:00 de Brasília (12:00 UTC) o job das 9h roda', async () => {
    process.env['BILLING_REMINDER_HOUR'] = '9';
    jest.useFakeTimers({ now: new Date('2026-09-23T12:10:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    const svc = servico();
    await svc.tickBillingJob();
    expect(svc.runBillingRemindersJob).toHaveBeenCalled();
  });

  it('hora e data de Brasília às 23:30 de 23/09', () => {
    const agora = new Date('2026-09-24T02:30:00Z'); // 23/09 23:30 em Brasília
    expect(horaBrasilia(agora)).toBe(23);
    // Mesmo formato das colunas @db.Date: meia-noite UTC da data de Brasília.
    expect(hojeBrasilia(agora).toISOString()).toBe('2026-09-23T00:00:00.000Z');
  });
});
