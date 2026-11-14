import { BadRequestException } from '@nestjs/common';
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

  function montar(opts: { vinculos?: { id_user: number; token: string | null }[]; tokenCriador?: string | null; cards?: string[] } = {}) {
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
      cards_Ao_Vivo: { findMany: jest.fn(async () => (opts.cards ?? []).map((fcm_token) => ({ fcm_token }))) },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const notifications: any = { sendPushNotification: jest.fn(async () => null) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    // Card ao vivo só quando o teste fala de card (senão a contagem não o consulta).
    const card: any = opts.cards
      ? { abrirDelivery: jest.fn(async () => undefined), atualizarDelivery: jest.fn(async () => ({ cobertos: new Set() })) }
      : undefined;
    const service = new DeliveryService(prisma, notifications, tenant, {} as any, card);
    return { service, prisma };
  }

  it('ninguém da unidade com app: avisados 0', async () => {
    const { service } = montar({ vinculos: [{ id_user: 10, token: null }, { id_user: 11, token: null }] });
    const r: any = await service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(r.status).toBe('AGUARDANDO_AUTORIZACAO');
    expect(r.avisados).toBe(0);
  });

  it('criador desvinculado sem card aberto: não conta', async () => {
    const { service } = montar({ vinculos: [], tokenCriador: 'tok-criador' });
    const r: any = await service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(r.avisados).toBe(0);
  });

  it('criador desvinculado acompanhando pelo card aberto: conta o aparelho do card', async () => {
    const { service, prisma } = montar({ vinculos: [], tokenCriador: 'tok-criador', cards: ['tok-card'] });
    const r: any = await service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(r.avisados).toBe(1);
    expect(prisma.cards_Ao_Vivo.findMany.mock.calls[0][0].where).toEqual({ origem: 'delivery', id_pedido: 5, encerrado_em: null });
  });

  it('conta por token distinto: dois tokens = 2; o mesmo aparelho em duas contas ou no card = 1', async () => {
    const a = montar({ vinculos: [{ id_user: 10, token: 'a' }, { id_user: 11, token: 'b' }, { id_user: 12, token: null }] });
    expect(((await a.service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro)) as any).avisados).toBe(2);
    const b = montar({ vinculos: [{ id_user: 10, token: 'a' }, { id_user: 11, token: 'a' }], cards: ['a'] });
    expect(((await b.service.atualizarStatus(5, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro)) as any).avisados).toBe(1);
  });

  it('outras transições não trazem avisados', async () => {
    const { service } = montar();
    const r: any = await service.atualizarStatus(5, { status: 'RETIRADA_NA_PORTARIA' } as any, porteiro);
    expect('avisados' in r).toBe(false);
  });

  it('previsão que não é data: 400, nada criado (antes virava "agora")', async () => {
    const { service, prisma } = montar();
    for (const previsao_em of ['amanhã 19h', '19:00', '2026-11-14 às 19h']) {
      const e = await service.criarAviso({ id_condominio: 1, id_apartamento: 101, previsao_em } as any, morador).catch((x) => x);
      expect(e).toBeInstanceOf(BadRequestException);
    }
    expect(prisma.deliveryAtendimentos.create).not.toHaveBeenCalled();
  });

  it('previsão sem fuso é horário de Brasília (19:00 → 22:00Z); com fuso fica como veio', async () => {
    const { service, prisma } = montar();
    await service.criarAviso({ id_condominio: 1, id_apartamento: 101, previsao_em: '2026-11-14T19:00:00.000' } as any, morador);
    expect(prisma.deliveryAtendimentos.create.mock.calls[0][0].data.previsao_em.toISOString()).toBe('2026-11-14T22:00:00.000Z');
    await service.criarAviso({ id_condominio: 1, id_apartamento: 101, previsao_em: '2026-11-14T19:00:00.000Z' } as any, morador);
    expect(prisma.deliveryAtendimentos.create.mock.calls[1][0].data.previsao_em.toISOString()).toBe('2026-11-14T19:00:00.000Z');
  });
});
