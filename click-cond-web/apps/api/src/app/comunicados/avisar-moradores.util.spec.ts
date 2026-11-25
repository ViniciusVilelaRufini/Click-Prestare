import { avisarMoradoresDoCondominio } from './avisar-moradores.util';

/**
 * J17 da revisão dos ciclos (jobs): o push do comunicado saía em série (um
 * await por morador — minutos num condomínio grande, e um deploy no meio
 * deixava parte sem aviso) e avisava o próprio autor do que ele publicou.
 */
describe('avisarMoradoresDoCondominio', () => {
  function deps(n: number, push: (token: string) => Promise<unknown>) {
    const users = Array.from({ length: n }, (_, i) => ({ fcm_token: `t${i}` }));
    const prisma: any = { users: { findMany: jest.fn(async () => users) } };
    const notifications: any = { sendPushNotification: jest.fn((token: string) => push(token)) };
    const logger: any = { error: jest.fn() };
    return { prisma, notifications, logger };
  }
  const aviso = { titulo: 'Novo comunicado', corpo: 'X', data: { type: 'comunicado', id: '1' } };

  it('exclui o autor da consulta', async () => {
    const d = deps(0, async () => 'ok');
    await avisarMoradoresDoCondominio(d, 1, { ...aviso, excluirUserId: 42 });
    expect(d.prisma.users.findMany.mock.calls[0][0].where.id).toEqual({ not: 42 });
  });

  it('sem autor conhecido (porteiro), a consulta não filtra id', async () => {
    const d = deps(0, async () => 'ok');
    await avisarMoradoresDoCondominio(d, 1, { ...aviso, excluirUserId: null });
    expect(d.prisma.users.findMany.mock.calls[0][0].where.id).toBeUndefined();
  });

  it('envia em paralelo com teto de 5 em voo, e uma falha não para as outras', async () => {
    let emVoo = 0;
    let pico = 0;
    const d = deps(23, async (token) => {
      emVoo++;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo--;
      if (token === 't3') throw new Error('FCM fora');
      return 'ok';
    });
    await avisarMoradoresDoCondominio(d, 1, aviso);
    expect(d.notifications.sendPushNotification).toHaveBeenCalledTimes(23);
    expect(pico).toBeGreaterThan(1);
    expect(pico).toBeLessThanOrEqual(5);
    expect(d.logger.error).toHaveBeenCalledTimes(1);
  });
});
