import { OcorrenciasService } from './ocorrencias.service';

/**
 * Resposta e mudança de status pelo console não avisavam o autor por push —
 * só atribuição e chat enviavam.
 */
describe('OcorrenciasService — push ao autor', () => {
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  function build(notifOcorrencias = 1) {
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
        update: jest.fn(async ({ data }: any) => ({ id: 7, user: 41, ...data })),
      },
      users: { findUnique: jest.fn(async () => ({ fcm_token: 'tok', notif_ocorrencias: notifOcorrencias })) },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok') };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, notifications, tenant);
    return { svc, notifications };
  }

  it('resposta pública avisa o autor', async () => {
    const { svc, notifications } = build();
    await svc.updateResposta(7, 'Vamos trocar hoje.', sindico);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'tok', 'Ocorrência respondida', 'Vamos trocar hoje.', { type: 'ocorrencia', id: '7' },
    );
  });

  it('mudança de status avisa o autor', async () => {
    const { svc, notifications } = build();
    await svc.updateStatus(7, 'Solucionado' as any, sindico);
    expect(notifications.sendPushNotification).toHaveBeenCalledWith(
      'tok', 'Ocorrência atualizada', 'Sua ocorrência #7 agora está: Solucionado.', { type: 'ocorrencia', id: '7' },
    );
  });

  it('respeita a preferência desligada', async () => {
    const { svc, notifications } = build(0);
    await svc.updateResposta(7, 'ok', sindico);
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });
});
