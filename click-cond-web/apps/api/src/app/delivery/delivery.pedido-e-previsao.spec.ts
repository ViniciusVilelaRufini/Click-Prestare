import { DeliveryService } from './delivery.service';

/**
 * - "Pedir autorização ao morador" para uma unidade onde ninguém tem o app
 *   (criador saiu ou foi desvinculado, sem outros moradores com aviso): a
 *   tela não dizia nada e o pedido ficava "Aguardando autorização" sem
 *   prazo. A resposta da portaria agora traz `avisados` — quantos moradores
 *   da unidade (e o criador) têm aparelho para receber o pedido.
 * - Previsão: o app manda "2026-11-14T19:00:00.000" sem fuso; o servidor
 *   (UTC) gravava 19:00Z e a portaria via 16:00. Texto sem fuso agora é
 *   horário de Brasília.
 */
describe('Delivery — pedido de autorização sem ninguém para receber; previsão no fuso de Brasília', () => {
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;
  const morador = { sub: 10, typeAccess: 'Morador' } as any;

  function montar(opts: { vinculos?: { id_user: number; token: string | null }[]; tokenCriador?: string | null } = {}) {
    const atendimento: any = {
      id: 5, id_condominio: 1, id_apartamento: 101, id_morador_user: 10, id_entregador: null,
      status: 'CHEGOU', motivo: null,
    };
    const vinculos = opts.vinculos ?? [{ id_user: 10, token: 'tok-criador' }];
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 101, id_condominio: 1 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) => {
          const v = vinculos.find((x) => x.id_user === where.id_user);
          return v ? { id: 1, user: { fcm_token: v.token } } : null;
        }),
        findMany: jest.fn(async () => vinculos.map((v) => ({ id_user: v.id_user, user: { fcm_token: v.token } }))),
      },
      users: { findUnique: jest.fn(async () => ({ fcm_token: opts.tokenCriador ?? null })) },
      deliveryAtendimentos: {
        create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })),
        findUnique: jest.fn(async () => ({ ...atendimento, apartamento: { bloco: 'A', apto: '101' }, entregador: null })),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(atendimento, data);
          return { count: 1 };
        }),
      },
      deliveryEventos: { create: jest.fn(async () => ({})) },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const notifications: any = { sendPushNotification: jest.fn(async () => null) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const service = new DeliveryService(prisma, notifications, tenant, {} as any);
    return { service, prisma };
  }

  it('ninguém da unidade com app: avisados 0', async () => {
    const { service } = montar({ vinculos: [{ id_user: 10, token: null }, { id_user: 11, token: null }] });
    const r: any = await service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(r.status).toBe('AGUARDANDO_AUTORIZACAO');
    expect(r.avisados).toBe(0);
  });

  it('criador desvinculado mas com app: conta (o card dele abre e ele pode responder)', async () => {
    const { service } = montar({ vinculos: [], tokenCriador: 'tok-criador' });
    const r: any = await service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(r.avisados).toBe(1);
  });

  it('criador e outro morador com app: 2 (cada pessoa uma vez)', async () => {
    const { service } = montar({ vinculos: [{ id_user: 10, token: 'a' }, { id_user: 11, token: 'b' }, { id_user: 12, token: null }] });
    const r: any = await service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(r.avisados).toBe(2);
  });

  it('outras transições não trazem avisados', async () => {
    const { service } = montar();
    const r: any = await service.atualizarStatus(5, { status: 'RETIRADA_NA_PORTARIA' } as any, porteiro);
    expect('avisados' in r).toBe(false);
  });

  it('previsão sem fuso é horário de Brasília (19:00 → 22:00Z); com fuso fica como veio', async () => {
    const { service, prisma } = montar();
    await service.criarAviso({ id_condominio: 1, id_apartamento: 101, previsao_em: '2026-11-14T19:00:00.000' } as any, morador);
    expect(prisma.deliveryAtendimentos.create.mock.calls[0][0].data.previsao_em.toISOString()).toBe('2026-11-14T22:00:00.000Z');
    await service.criarAviso({ id_condominio: 1, id_apartamento: 101, previsao_em: '2026-11-14T19:00:00.000Z' } as any, morador);
    expect(prisma.deliveryAtendimentos.create.mock.calls[1][0].data.previsao_em.toISOString()).toBe('2026-11-14T19:00:00.000Z');
  });
});
