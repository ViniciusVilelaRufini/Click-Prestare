import { DeliveryService } from './delivery.service';

/** Delivery ligado ao card ao vivo (spec 2026-11-13-card-ao-vivo-delivery-design.md). */
describe('DeliveryService — card ao vivo', () => {
  const morador = { sub: 10, typeAccess: 'Morador' } as any;
  const porteiro = { sub: 20, id_condominio: 1, nome: 'Portaria' } as any;

  function montar(opts: { status: string; idEntregador?: number | null; card?: any } = { status: 'AGENDADA' }) {
    const atendimento: any = {
      id: 9,
      id_condominio: 1,
      id_apartamento: 101,
      id_morador_user: 10,
      id_entregador: opts.idEntregador === undefined ? 7 : opts.idEntregador,
      status: opts.status,
      estabelecimento: 'Burger King',
      modo_entrega: 'UNIDADE',
      chegou_em: new Date('2026-11-13T15:40:00Z'),
      autorizado_em: null,
      recusado_em: null,
      concluido_em: null,
      motivo: null,
    };
    const entregador = { id: 7, id_condominio: 1, nome: 'Carlos', plataforma: 'iFood', foto: 'https://bucket/entregadores/7.jpg', status: 'ATIVO' };
    const prisma: any = {
      deliveryAtendimentos: {
        findUnique: jest.fn(async ({ include }: any) =>
          include ? { ...atendimento, apartamento: { bloco: 'A', apto: '106' }, entregador: atendimento.id_entregador ? entregador : null } : { ...atendimento },
        ),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(atendimento, data);
          return { count: 1 };
        }),
      },
      deliveryEntregadores: { findUnique: jest.fn(async () => entregador) },
      deliveryEventos: { create: jest.fn(async () => ({})) },
      apartamentos_Users: { findFirst: jest.fn(async () => ({ id: 1, user: { fcm_token: 'fcm-iphone' } })) },
    };
    prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined), assertEntidade: jest.fn(async () => undefined) };
    const card =
      opts.card === null
        ? undefined
        : {
            abrirDelivery: jest.fn(async () => undefined),
            atualizarDelivery: jest.fn(async () => ({ cobertos: new Set<string>() })),
            ...(opts.card ?? {}),
          };
    const service = new DeliveryService(prisma, notifications, tenant, {} as any, card as any);
    return { service, notifications, card, atendimento };
  }

  it('portaria marca CHEGOU: abre o card do morador que criou o aviso, com entregador e foto, sem a notificação solta', async () => {
    const { service, card, notifications } = montar({ status: 'AGENDADA' });
    await service.atualizarStatus(9, { status: 'CHEGOU' } as any, porteiro);
    expect(card!.abrirDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 9,
        status: 'CHEGOU',
        estabelecimento: 'Burger King',
        bloco: 'A',
        apto: '106',
        entregadorNome: 'Carlos',
        entregadorPlataforma: 'iFood',
        fotoEntregador: 'https://bucket/entregadores/7.jpg',
      }),
      10,
    );
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('AGUARDANDO_AUTORIZACAO com card confirmado no aparelho do morador: só o card', async () => {
    const { service, card, notifications } = montar({
      status: 'CHEGOU',
      card: { atualizarDelivery: jest.fn(async () => ({ cobertos: new Set(['fcm-iphone']) })) },
    });
    await service.atualizarStatus(9, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(card!.atualizarDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: 'AGUARDANDO_AUTORIZACAO' }), 10, { voceRespondeu: false });
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('AGUARDANDO_AUTORIZACAO sem card confirmado: a notificação de hoje vai', async () => {
    const { service, notifications } = montar({ status: 'CHEGOU' });
    await service.atualizarStatus(9, { status: 'AGUARDANDO_AUTORIZACAO' } as any, porteiro);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'fcm-iphone',
      'Delivery',
      'A portaria aguarda sua autorização para a entrega.',
      { id_delivery: '9', status: 'AGUARDANDO_AUTORIZACAO' },
    );
  });

  it('[RF 3] morador autoriza pela tela do app: card com voceRespondeu e nenhuma notificação', async () => {
    const { service, card, notifications } = montar({ status: 'AGUARDANDO_AUTORIZACAO' });
    await service.atualizarStatus(9, { status: 'AUTORIZADA' } as any, morador);
    expect(card!.atualizarDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: 'AUTORIZADA' }), 10, { voceRespondeu: true });
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('card lança erro: a notificação de hoje vai assim mesmo e a resposta não falha', async () => {
    const { service, notifications } = montar({
      status: 'AGENDADA',
      card: { abrirDelivery: jest.fn(async () => { throw new Error('APNs fora'); }) },
    });
    await expect(service.atualizarStatus(9, { status: 'CHEGOU' } as any, porteiro)).resolves.toBeTruthy();
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'fcm-iphone',
      'Delivery',
      'Seu entregador chegou à portaria.',
      { id_delivery: '9', status: 'CHEGOU' },
    );
  });

  it('sem o serviço do card: comportamento de hoje', async () => {
    const { service, notifications } = montar({ status: 'AGENDADA', card: null });
    await service.atualizarStatus(9, { status: 'CHEGOU' } as any, porteiro);
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('morador cancela o aviso agendado: card recebe CANCELADA (encerra se houver) e ninguém é notificado', async () => {
    const { service, card, notifications } = montar({ status: 'AGENDADA' });
    await service.atualizarStatus(9, { status: 'CANCELADA', motivo: 'Cancelado pelo morador.' } as any, morador);
    expect(card!.atualizarDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELADA' }), 10, { voceRespondeu: true });
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });
});
