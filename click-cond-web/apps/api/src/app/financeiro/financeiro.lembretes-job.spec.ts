import { FinanceiroService } from './financeiro.service';

/**
 * Job horário de lembrete de cobrança (5 dias antes, no dia, e no dia seguinte
 * ao vencimento).
 *
 * Ele extraía a unidade da fatura com regex PRÓPRIO,
 * `/Apto\s+(\S+)\s+Bloco\s+(\S+)/`, que exige o trecho " Bloco X". Fatura de
 * condomínio sem bloco — "Apto 5 - Ref. 08/2026", exatamente o que
 * `montarNomeLancamento` gera quando o apartamento não tem bloco — nunca
 * casava, e o `continue` pulava calado. Esses condomínios não recebiam
 * lembrete nenhum, e nada no sistema acusava.
 */
describe('FinanceiroService — job de lembretes de cobrança', () => {
  /** Vencimento daqui a 5 dias: o gatilho do lembrete antecipado. */
  function em5Dias(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 5);
    return d;
  }

  function montar(fatura: any, apartamentos: any[]) {
    const findManyUsers = jest.fn(async () => [
      { fcm_token: null, email: 'morador@x.com', name: 'Fulano' },
    ]);

    const prisma: any = {
      isConnected: true,
      financeiro: { findMany: jest.fn(async () => [fatura]) },
      apartamentos: { findMany: jest.fn(async () => apartamentos) },
      users: { findMany: findManyUsers },
    };

    const mail = { sendBillingReminder: jest.fn(async () => undefined) };
    const notifications = { sendPushNotification: jest.fn(async () => undefined) };

    const svc: any = new FinanceiroService(
      prisma, {} as any, mail as any, notifications as any,
      {} as any, {} as any, {} as any, {} as any,
    );

    return { svc, mail, findManyUsers };
  }

  it('avisa condomínio SEM bloco — o caso que o regex antigo pulava calado', async () => {
    const { svc, mail } = montar(
      { id: 1, nome: 'Apto 5 - Ref. 08/2026', valor: 50, data_vencimento: em5Dias(), id_condominio: 7, pix_copia_cola: '' },
      [{ apto: '5', bloco: null }],
    );

    const stats = await svc.runBillingRemindersJob();

    expect(stats.emailsEnviados).toBe(1);
    expect(mail.sendBillingReminder).toHaveBeenCalled();
  });

  it('continua avisando condomínio COM bloco', async () => {
    const { svc, mail } = montar(
      { id: 1, nome: 'Apto 1 Bloco a - Ref. 08/2026', valor: 9, data_vencimento: em5Dias(), id_condominio: 7, pix_copia_cola: '' },
      [{ apto: '1', bloco: 'a' }],
    );

    const stats = await svc.runBillingRemindersJob();

    expect(stats.emailsEnviados).toBe(1);
    expect(mail.sendBillingReminder).toHaveBeenCalled();
  });

  it('avisa apartamento cuja identificação tem espaço ("10 A")', async () => {
    // O `(\S+)` do regex antigo parava no espaço e não casava.
    const { svc, mail } = montar(
      { id: 1, nome: 'Apto 10 A Bloco A - Ref. 08/2026', valor: 70, data_vencimento: em5Dias(), id_condominio: 7, pix_copia_cola: '' },
      [{ apto: '10 A', bloco: 'A' }],
    );

    const stats = await svc.runBillingRemindersJob();

    expect(stats.emailsEnviados).toBe(1);
    expect(mail.sendBillingReminder).toHaveBeenCalled();
  });

  it('não avisa ninguém quando a fatura não aponta para uma unidade real', async () => {
    // Lançamento avulso do condomínio não tem dono; mandar para "alguém" seria
    // cobrar a pessoa errada.
    const { svc, mail } = montar(
      { id: 1, nome: 'Manutenção do elevador', valor: 1200, data_vencimento: em5Dias(), id_condominio: 7, pix_copia_cola: '' },
      [{ apto: '1', bloco: 'a' }],
    );

    const stats = await svc.runBillingRemindersJob();

    expect(stats.emailsEnviados).toBe(0);
    expect(mail.sendBillingReminder).not.toHaveBeenCalled();
  });

  it('procura o morador pelos dois vínculos, como a tela do morador faz', async () => {
    const { svc, findManyUsers } = montar(
      { id: 1, nome: 'Apto 1 Bloco a - Ref. 08/2026', valor: 9, data_vencimento: em5Dias(), id_condominio: 7, pix_copia_cola: '' },
      [{ apto: '1', bloco: 'a' }],
    );

    await svc.runBillingRemindersJob();

    const where = findManyUsers.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.OR[1].apartamentosUsers.some.apartamento).toMatchObject({ id_condominio: 7, apto: '1' });
  });
});
