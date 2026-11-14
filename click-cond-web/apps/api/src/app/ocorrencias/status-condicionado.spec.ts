import { ConflictException } from '@nestjs/common';
import { OcorrenciasService } from './ocorrencias.service';

/**
 * Mudar o status a partir de uma lista desatualizada fazia a ocorrência
 * regredir: o porteiro B, com a tela de 30 s atrás, clicava "Marcar como
 * ciente" numa ocorrência que o porteiro A acabara de solucionar, e a API
 * gravava sem olhar o estado atual (o morador recebia "Ciente" depois de
 * "Solucionado"). Agora a escrita é condicionada ao status de origem:
 *  - Ciente só a partir de Pendente;
 *  - Solucionado a partir de Pendente ou Ciente;
 *  - Reabrir só a partir de Solucionado — e grava Ciente (a equipe já tocou
 *    nela; Pendente devolvia ao autor o direito de editar e apagar).
 * Fora disso: 409 e nada é gravado nem avisado.
 */
describe('Ocorrências — status condicionado ao estado de origem', () => {
  const sindico = { sub: 7, typeAccess: 'Sindico' } as any;

  function montar(status: string) {
    const oc: any = { id: 5, id_condominio: 1, user: 100, status, tipo: 2, prazo: null };
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () => ({ ...oc })),
        update: jest.fn(async ({ data }: any) => ({ ...oc, ...data })),
        // Simula o MySQL: só grava se o status atual está entre os de origem.
        updateMany: jest.fn(async ({ where, data }: any) => {
          const origens: string[] = where.status?.in ?? [where.status];
          if (!origens.map((s) => s.toLowerCase()).includes(String(oc.status).toLowerCase())) return { count: 0 };
          Object.assign(oc, data);
          return { count: 1 };
        }),
      },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: 24 })) },
      users: { findUnique: jest.fn(async () => ({ fcm_token: 'tok', notif_ocorrencias: 1 })) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const notifications: any = { sendPushNotification: jest.fn(async () => 'ok') };
    const svc = new OcorrenciasService(prisma, notifications, tenant, {} as any);
    return { svc, prisma, notifications, oc };
  }

  it('Solucionado → "Marcar como ciente" (lista velha): 409, nada gravado, morador não é avisado', async () => {
    const { svc, prisma, notifications, oc } = montar('Solucionado');
    const e: any = await svc.updateStatus(5, 'Ciente', sindico).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.message).toContain('Solucionado');
    expect(oc.status).toBe('Solucionado');
    expect(prisma.ocorrencias.update).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });

  it('Ciente → Ciente e Solucionado → Solucionado: 409 "já está"', async () => {
    for (const s of ['Ciente', 'Solucionado'] as const) {
      const { svc } = montar(s);
      const e: any = await svc.updateStatus(5, s, sindico).catch((x) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.message).toContain(`já está ${s}`);
    }
  });

  it('Pendente → Ciente → Solucionado: grava, condicionado à origem', async () => {
    const { svc, prisma, oc } = montar('Pendente');
    await svc.updateStatus(5, 'Ciente', sindico);
    expect(prisma.ocorrencias.updateMany.mock.calls[0][0].where).toEqual({ id: 5, status: { in: ['Pendente'] } });
    expect(oc.status).toBe('Ciente');
    await svc.updateStatus(5, 'Solucionado', sindico);
    expect(prisma.ocorrencias.updateMany.mock.calls[1][0].where).toEqual({ id: 5, status: { in: ['Pendente', 'Ciente'] } });
    expect(oc.status).toBe('Solucionado');
  });

  it('reabrir (pedido "Pendente"): só a partir de Solucionado, grava Ciente com prazo novo', async () => {
    const { svc, prisma, notifications, oc } = montar('Solucionado');
    const r: any = await svc.updateStatus(5, 'Pendente', sindico);
    expect(r.status).toBe('Ciente');
    const { where, data } = prisma.ocorrencias.updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: 5, status: { in: ['Solucionado'] } });
    expect(data.status).toBe('Ciente');
    expect(data.prazo).toBeInstanceOf(Date);
    expect(oc.status).toBe('Ciente');
    expect(notifications.sendPushNotification.mock.calls[0][2]).toContain('reaberta');
  });

  it('Reabrir desatualizado (já reaberta por outro): 409', async () => {
    const { svc } = montar('Ciente');
    const e = await svc.updateStatus(5, 'Pendente', sindico).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
  });

  it('corrida: o status muda entre a leitura e a escrita → 409', async () => {
    const { svc, prisma } = montar('Pendente');
    prisma.ocorrencias.updateMany.mockResolvedValueOnce({ count: 0 });
    const e = await svc.updateStatus(5, 'Ciente', sindico).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
  });
});
