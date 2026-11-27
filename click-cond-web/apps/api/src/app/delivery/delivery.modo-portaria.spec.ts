import { DeliveryService } from './delivery.service';

/**
 * Aviso "Na portaria" (modo_entrega PORTARIA): o "Autorizar" do morador ao
 * pedido da portaria deixa a entrega na portaria (RETIRADA_NA_PORTARIA), não
 * manda o entregador subir. Pedido do portão (QR) e respostas da portaria
 * continuam como hoje.
 */
describe('DeliveryService — aviso "Na portaria"', () => {
  const morador = { sub: 10, typeAccess: 'Morador' } as any;
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;

  function montar(opts: { modo: 'PORTARIA' | 'UNIDADE'; idPedidoPortao?: number | null }) {
    const atendimento: any = {
      id: 9,
      id_condominio: 1,
      id_apartamento: 101,
      id_morador_user: 10,
      id_entregador: 7,
      id_pedido_portao: opts.idPedidoPortao ?? null,
      status: 'AGUARDANDO_AUTORIZACAO',
      origem: 'portaria',
      estabelecimento: 'Burger King',
      modo_entrega: opts.modo,
      chegou_em: new Date('2026-11-16T15:40:00Z'),
      autorizado_em: null,
      recusado_em: null,
      concluido_em: null,
      motivo: null,
    };
    const entregador = { id: 7, id_condominio: 1, nome: 'Carlos', plataforma: 'iFood', foto: null, status: 'ATIVO' };
    const pedido = {
      id: 50,
      id_atendimento: 9,
      status: 'pendente',
      expira_em: new Date(Date.now() + 10 * 60_000),
      nome: 'Carlos',
    };
    const prisma: any = {
      deliveryAtendimentos: {
        findUnique: jest.fn(async ({ include }: any) =>
          include ? { ...atendimento, apartamento: { bloco: 'A', apto: '106' }, entregador } : { ...atendimento },
        ),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(atendimento, data);
          return { count: 1 };
        }),
      },
      deliveryEntregadores: { findUnique: jest.fn(async () => entregador) },
      deliveryEventos: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
      deliveryPedidosPortao: {
        findUnique: jest.fn(async () => (atendimento.id_pedido_portao ? { ...pedido } : null)),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      apartamentos_Users: {
        findFirst: jest.fn(async () => ({ id: 1, user: { fcm_token: 'fcm-iphone' } })),
        findMany: jest.fn(async () => [{ id_user: 10 }]),
      },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const card = {
      abrirDelivery: jest.fn(async () => undefined),
      atualizarDelivery: jest.fn(async () => ({ cobertos: new Set<string>() })),
      encerrarDeOutros: jest.fn(async () => undefined),
    };
    const service = new DeliveryService(prisma, notifications, tenant, {} as any, card as any);
    return { service, prisma, card };
  }

  it('morador autoriza aviso PORTARIA sem pedido de portão → grava RETIRADA_NA_PORTARIA', async () => {
    const { service, prisma, card } = montar({ modo: 'PORTARIA', idPedidoPortao: null });
    const r: any = await service.atualizarStatus(9, { status: 'AUTORIZADA' } as any, morador);

    const { data } = prisma.deliveryAtendimentos.updateMany.mock.calls[0][0];
    expect(data.status).toBe('RETIRADA_NA_PORTARIA');
    expect(data).not.toHaveProperty('autorizado_em');
    expect(prisma.deliveryEventos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status_anterior: 'AGUARDANDO_AUTORIZACAO', status_novo: 'RETIRADA_NA_PORTARIA' }),
    });
    expect(card.atualizarDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RETIRADA_NA_PORTARIA' }),
      10,
      { voceRespondeu: true },
    );
    expect(r.status).toBe('RETIRADA_NA_PORTARIA');
  });

  it('morador autoriza aviso UNIDADE → continua AUTORIZADA', async () => {
    const { service, prisma } = montar({ modo: 'UNIDADE', idPedidoPortao: null });
    await service.atualizarStatus(9, { status: 'AUTORIZADA' } as any, morador);

    const { data } = prisma.deliveryAtendimentos.updateMany.mock.calls[0][0];
    expect(data.status).toBe('AUTORIZADA');
    expect(data.autorizado_em).toBeInstanceOf(Date);
    expect(prisma.deliveryEventos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status_anterior: 'AGUARDANDO_AUTORIZACAO', status_novo: 'AUTORIZADA' }),
    });
  });

  it('aviso PORTARIA com pedido de portão pendente → continua AUTORIZADA', async () => {
    const { service, prisma } = montar({ modo: 'PORTARIA', idPedidoPortao: 50 });
    await service.atualizarStatus(9, { status: 'AUTORIZADA' } as any, morador);

    const { data } = prisma.deliveryAtendimentos.updateMany.mock.calls[0][0];
    expect(data.status).toBe('AUTORIZADA');
    expect(data.autorizado_em).toBeInstanceOf(Date);
    expect(prisma.deliveryEventos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status_anterior: 'AGUARDANDO_AUTORIZACAO', status_novo: 'AUTORIZADA' }),
    });
  });

  it('portaria (console) autoriza aviso PORTARIA → continua AUTORIZADA', async () => {
    const { service, prisma } = montar({ modo: 'PORTARIA', idPedidoPortao: null });
    await service.atualizarStatus(9, { status: 'AUTORIZADA' } as any, porteiro);

    const { data } = prisma.deliveryAtendimentos.updateMany.mock.calls[0][0];
    expect(data.status).toBe('AUTORIZADA');
    expect(data.autorizado_em).toBeInstanceOf(Date);
    expect(prisma.deliveryEventos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status_anterior: 'AGUARDANDO_AUTORIZACAO', status_novo: 'AUTORIZADA' }),
    });
  });
});
