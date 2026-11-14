import { OcorrenciasService } from './ocorrencias.service';

/**
 * Reabrir (Solucionado → Ciente; a tela pede 'Pendente') mantinha o prazo
 * original: a ocorrência voltava já "Atrasada". O prazo agora recomeça de
 * agora, pelo SLA da categoria — a mesma conta do cadastro.
 */
describe('Ocorrências — reabrir recalcula o prazo', () => {
  const sindico = { sub: 7, typeAccess: 'Sindico' } as any;

  function montar(status: string, slaHoras: number | null = 24) {
    const oc = { id: 5, id_condominio: 1, user: 100, status, tipo: 2, prazo: new Date('2026-01-01T00:00:00Z') };
    const prisma: any = {
      isConnected: true,
      ocorrencias: {
        findUnique: jest.fn(async () => ({ ...oc })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      ocorrencias_Categorias: { findUnique: jest.fn(async () => ({ sla_horas: slaHoras })) },
      users: { findUnique: jest.fn(async () => null) },
    };
    const tenant: any = { assertEntidade: jest.fn(async () => undefined) };
    const svc = new OcorrenciasService(prisma, { sendPushNotification: jest.fn() } as any, tenant, {} as any);
    return { svc, prisma };
  }

  it('Solucionado → reaberta: Ciente, prazo = agora + SLA da categoria', async () => {
    const { svc, prisma } = montar('Solucionado', 24);
    const antes = Date.now();
    await svc.updateStatus(5, 'Pendente', sindico);
    const { data } = prisma.ocorrencias.updateMany.mock.calls[0][0];
    expect(data.status).toBe('Ciente');
    expect(data.prazo).toBeInstanceOf(Date);
    const delta = data.prazo.getTime() - antes;
    expect(delta).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
    expect(delta).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000);
  });

  it('categoria sem SLA: reaberta fica sem prazo', async () => {
    const { svc, prisma } = montar('Solucionado', null);
    await svc.updateStatus(5, 'Pendente', sindico);
    expect(prisma.ocorrencias.updateMany.mock.calls[0][0].data.prazo).toBeNull();
  });

  it('Pendente → Ciente não mexe no prazo', async () => {
    const { svc, prisma } = montar('Pendente');
    await svc.updateStatus(5, 'Ciente', sindico);
    expect(prisma.ocorrencias.updateMany.mock.calls[0][0].data).toEqual({ status: 'Ciente' });
  });
});
