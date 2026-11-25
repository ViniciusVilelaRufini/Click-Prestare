import { FacialService } from './facial.service';

/**
 * OFFLINE/ONLINE gravam o nome do APARELHO em usuario_nome. Com operador logado (ex.: POST
 * /devices/:id/test), um terminal chamado "Portaria" virava o nome do operador, porque
 * AuditoriaService.registrar troca rótulo genérico pelo nome do token. Os dois pontos pedem
 * `manterNome: true`.
 */
describe('FacialService — status do dispositivo no log mantém o nome do aparelho', () => {
  function build(ultimaAcao: string | null) {
    const prisma: any = {
      auditLog: { findFirst: jest.fn(async () => (ultimaAcao ? { acao: ultimaAcao, created_at: new Date() } : null)) },
      ocorrencias: {
        findFirst: jest.fn(async () => ({ id: 1 })),
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async () => ({ count: 0 })),
        update: jest.fn(async () => ({})),
        create: jest.fn(async () => ({})),
      },
      ocorrencias_Categorias: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const agent: any = { reportDeviceStatus: jest.fn(async () => ({ shouldOpenTicket: false })) };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, auditoria,
      null as any, agent, null as any, null as any, null as any,
    );
    return { svc, auditoria };
  }
  const device = { id: 5, nome: 'Portaria', tipo: 'facial', id_condominio: 10 };

  it('OFFLINE', async () => {
    const { svc, auditoria } = build('ONLINE');
    await (svc as any).handleDeviceStatusTransition(device, false, true);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'OFFLINE', usuario_nome: 'Portaria', manterNome: true }),
    );
  });

  it('ONLINE', async () => {
    const { svc, auditoria } = build('OFFLINE');
    await (svc as any).handleDeviceStatusTransition(device, true, true);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'ONLINE', usuario_nome: 'Portaria', manterNome: true }),
    );
  });
});
