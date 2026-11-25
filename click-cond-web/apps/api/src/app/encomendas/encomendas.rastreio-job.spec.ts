jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

import axios from 'axios';
import { EncomendasService } from './encomendas.service';

/**
 * J13 da revisão dos ciclos (jobs): rastreio dos Correios a cada 2 h.
 *  (a) código que começa com 'TEST' gerava push falso de "saiu para entrega"
 *      3 min depois — inclusive em produção;
 *  (b) push e update({notificado:2}) não eram atômicos: falha do update (ou
 *      duas passadas) = morador avisado de novo a cada 2 h;
 *  (c) sem idade máxima nem teto de itens por passada.
 */
describe('Encomendas — job de rastreio', () => {
  const nodeEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = nodeEnv;
    (axios.get as jest.Mock).mockReset();
  });

  function build(encomendas: any[]) {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findMany: jest.fn(async () => encomendas),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const e = encomendas.find((x) => x.id === where.id && x.notificado === where.notificado);
          if (!e) return { count: 0 };
          Object.assign(e, data);
          return { count: 1 };
        }),
      },
      users: { findMany: jest.fn(async () => [{ fcm_token: 'fcm-1' }]) },
    };
    const notifications: any = { sendPushNotification: jest.fn(async () => undefined) };
    const svc = new EncomendasService(prisma, notifications, {} as any, {} as any, {} as any);
    return { svc, prisma, notifications };
  }

  const velha = (min: number) => new Date(Date.now() - min * 60_000);
  const enc = (over: any = {}) => ({
    id: 1, id_condominio: 1, destinatario_apto: '101', destinatario_bloco: 'A', descricao: 'Caixa',
    codigo_rastreio: 'TEST123', status: 'Esperando', notificado: 0, created_at: velha(10), ...over,
  });

  it('(a) em produção, código TEST não gera push falso', async () => {
    process.env['NODE_ENV'] = 'production';
    const { svc, notifications } = build([enc()]);
    await svc.tickTrackingJob();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('(a) fora de produção, o código TEST continua simulando', async () => {
    process.env['NODE_ENV'] = 'development';
    const { svc, notifications } = build([enc()]);
    await svc.tickTrackingJob();
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('(b) marca notificado de forma condicional ANTES do push; duas passadas avisam uma vez só', async () => {
    process.env['NODE_ENV'] = 'production';
    (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { eventos: [{ status: 'Objeto saiu para entrega ao destinatário' }] } });
    const lista = [enc({ codigo_rastreio: 'AA123456789BR' })];
    const { svc, prisma, notifications } = build(lista);

    const ordem: string[] = [];
    prisma.encomendas.updateMany.mockImplementation(async ({ where, data }: any) => {
      ordem.push('marca');
      const e = lista.find((x) => x.id === where.id && x.notificado === where.notificado);
      if (!e) return { count: 0 };
      Object.assign(e, data);
      return { count: 1 };
    });
    notifications.sendPushNotification.mockImplementation(async () => { ordem.push('push'); });

    await svc.tickTrackingJob();
    // A passada seguinte (ou outra instância) ainda vê a cópia antiga com notificado 0.
    lista[0] = { ...lista[0], notificado: 0 };
    prisma.encomendas.findMany.mockResolvedValueOnce([{ ...lista[0] }]);
    lista[0].notificado = 2;
    await svc.tickTrackingJob();

    expect(prisma.encomendas.updateMany.mock.calls[0][0]).toEqual({ where: { id: 1, notificado: 0 }, data: { notificado: 2 } });
    expect(ordem[0]).toBe('marca');
    expect(notifications.sendPushNotification).toHaveBeenCalledTimes(1);
    expect(prisma.encomendas.update).not.toHaveBeenCalled();
  });

  it('(c) só encomendas dos últimos 30 dias, com teto de itens por passada', async () => {
    const { svc, prisma } = build([]);
    await svc.tickTrackingJob();
    const args = prisma.encomendas.findMany.mock.calls[0][0];
    const desde: Date = args.where.created_at.gte;
    const dias = (Date.now() - desde.getTime()) / 86_400_000;
    expect(Math.round(dias)).toBe(30);
    expect(args.take).toBeGreaterThan(0);
    expect(args.take).toBeLessThanOrEqual(500);
  });

  it('código de rastreio vai escapado na URL', async () => {
    process.env['NODE_ENV'] = 'production';
    (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { eventos: [] } });
    const { svc } = build([enc({ codigo_rastreio: 'AA1&user=x' })]);
    await svc.tickTrackingJob();
    expect((axios.get as jest.Mock).mock.calls[0][0]).toContain('codigo=AA1%26user%3Dx');
  });
});
