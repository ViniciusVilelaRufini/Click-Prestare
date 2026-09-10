import { FinanceiroService } from './financeiro.service';

/**
 * `notifyInadimplente` é o botão "Notificar Morador" do histórico de pendências.
 *
 * Ele achava a DÍVIDA por regex sobre o nome da fatura, mas achava as PESSOAS
 * por igualdade estrita em `Moradores.bloco/apartamento` — e a leitura do
 * morador (`getByUser`) considera também o vínculo em `Apartamentos_Users`.
 * Quando as duas visões discordavam, ninguém era notificado e a tela mostrava
 * banner verde de sucesso: o síndico riscava o apartamento da lista achando
 * que tinha cobrado.
 */
describe('FinanceiroService — notifyInadimplente', () => {
  function montar(opcoes: {
    faturas?: any[];
    usuarios?: any[];
  } = {}) {
    const faturas = opcoes.faturas ?? [
      { id: 1, nome: 'Apto 1 Bloco a - Ref. 08/2026', valor: 9, data_vencimento: new Date(2026, 7, 1), pago: 0, status: '0' },
    ];

    const findManyUsers = jest.fn(async () => opcoes.usuarios ?? []);
    const prisma: any = {
      isConnected: true,
      financeiro: { findMany: jest.fn(async () => faturas) },
      users: { findMany: findManyUsers },
    };

    const notifications = { sendPushNotification: jest.fn(async () => undefined) };
    const mail = { sendBillingReminder: jest.fn(async () => undefined) };
    const tenant = { assertCondominio: jest.fn(async () => undefined) };

    // Ordem do construtor: prisma, storage, mail, notifications, auditoria,
    // fechamento, openPix, tenant.
    const svc: any = new FinanceiroService(
      prisma, {} as any, mail as any, notifications as any,
      {} as any, {} as any, {} as any, tenant as any,
    );

    return { svc, findManyUsers, notifications, mail };
  }

  it('RECUSA com motivo quando não há morador cadastrado na unidade', async () => {
    // Antes devolvia success: true e a tela dizia "Cobrança enviada com
    // sucesso!" sem ter enviado nada.
    const { svc, notifications, mail } = montar({ usuarios: [] });

    const r = await svc.notifyInadimplente(7, '1', 'a');

    expect(r.success).toBe(false);
    expect(r.message).toContain('Nenhum morador cadastrado');
    expect(r.moradoresNotificados).toBe(0);
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    expect(mail.sendBillingReminder).not.toHaveBeenCalled();
  });

  it('RECUSA quando o morador existe mas não tem e-mail nem app', async () => {
    const { svc } = montar({
      usuarios: [{ id: 10, name: 'Fulano', email: null, fcm_token: null }],
    });

    const r = await svc.notifyInadimplente(7, '1', 'a');

    expect(r.success).toBe(false);
    expect(r.message).toContain('não tem e-mail cadastrado');
    // A unidade TEM morador — o número precisa refletir isso, senão o síndico
    // procura um cadastro que já existe.
    expect(r.moradoresNotificados).toBe(1);
  });

  it('procura o morador pelos DOIS vínculos, como a tela do morador faz', async () => {
    const { svc, findManyUsers } = montar({
      usuarios: [{ id: 10, name: 'Fulano', email: 'f@x.com', fcm_token: null }],
    });

    await svc.notifyInadimplente(7, '1', 'a');

    const where = findManyUsers.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].moradores.some).toMatchObject({ id_condominio: 7, apartamento: '1' });
    expect(where.OR[1].apartamentosUsers.some.apartamento).toMatchObject({ id_condominio: 7, apto: '1' });
  });

  it('condomínio sem bloco: aceita bloco vazio e nulo no cadastro', async () => {
    // A tela manda `bloco=""`; o cadastro guarda `null`. A igualdade estrita
    // não casava com ninguém, e nenhum morador era notificado.
    const { svc, findManyUsers } = montar({
      faturas: [
        { id: 1, nome: 'Apto 5 - Ref. 08/2026', valor: 50, data_vencimento: new Date(2026, 7, 1), pago: 0, status: '0' },
      ],
      usuarios: [{ id: 10, name: 'Fulano', email: 'f@x.com', fcm_token: null }],
    });

    await svc.notifyInadimplente(7, '5', '');

    const where = findManyUsers.mock.calls[0][0].where;
    expect(where.OR[0].moradores.some.bloco).toEqual({ in: ['', null] });
  });

  it('notifica e reporta sucesso quando há canal de verdade', async () => {
    const { svc, mail } = montar({
      usuarios: [{ id: 10, name: 'Fulano', email: 'f@x.com', fcm_token: null }],
    });

    const r = await svc.notifyInadimplente(7, '1', 'a');

    expect(r.success).toBe(true);
    expect(r.emailsEnviados).toBe(1);
    expect(mail.sendBillingReminder).toHaveBeenCalled();
  });
});
