import { ComunicadosService } from './comunicados.service';

/** Comunicado novo só aparecia na lista de notificações do app, sem push. */
describe('ComunicadosService.create — push aos moradores', () => {
  it('envia push para cada morador do condomínio com a preferência ligada', async () => {
    const prisma: any = {
      isConnected: true,
      comunicados: {
        create: jest.fn(async () => ({ id: 11, titulo: 'Troca do portão', id_condominio: 1 })),
        findUnique: jest.fn(async () => ({ id: 11, titulo: 'Troca do portão', id_condominio: 1 })),
      },
      users: { findMany: jest.fn(async () => [{ fcm_token: 'a' }, { fcm_token: 'b' }]) },
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok') };
    const service = new ComunicadosService(prisma, { registrar: jest.fn() } as any, tenant, notifications);

    await service.create({ titulo: 'Troca do portão', id_condominio: 1 } as any, {
      sub: 1, typeAccess: 'Sindico', user: { id: 1 },
    } as any);
    await new Promise((r) => setImmediate(r));

    expect(prisma.users.findMany).toHaveBeenCalledWith({
      where: { notif_comunicados: 1, fcm_token: { not: null }, moradores: { some: { id_condominio: 1 } } },
      select: { fcm_token: true },
    });
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(2);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'a', 'Novo comunicado', 'Troca do portão', { type: 'comunicado', id: '11' },
    );
  });
});
