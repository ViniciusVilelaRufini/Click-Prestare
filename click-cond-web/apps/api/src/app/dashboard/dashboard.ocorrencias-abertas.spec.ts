import { DashboardService } from './dashboard.service';

/**
 * O cartão "Ocorrências pendentes · urgente" do console contava só status
 * 'Pendente' (o app conta tudo que não está Solucionado) e acendia "urgente"
 * para qualquer pendente. Agora:
 *  - aberta = status diferente de Solucionado, a mesma definição do app;
 *  - urgente = aberta com prazo vencido ou categoria de prioridade CRÍTICA
 *    (exatamente 1 — 0 é o padrão de categoria sem valor, 2 é "alta");
 *  - evento de status de dispositivo (AuditLog) sai como "Dispositivo", não
 *    como "Ocorrência" que levava à lista de ocorrências.
 */
describe('DashboardService — ocorrências abertas, urgentes e eventos de dispositivo', () => {
  function montar(auditLogs: any[] = []) {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
    const prisma: any = {
      isConnected: true,
      visitantes: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      visitas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      pessoas: { findMany: jest.fn(async () => []) },
      prestadores_servico: { count: jest.fn(async () => 0) },
      ocorrencias: {
        // Abertas: 5; das abertas, 2 urgentes (o filtro com OR identifica a consulta).
        count: jest.fn(async ({ where }: any) => (where.OR ? 2 : 5)),
        findMany: jest.fn(async () => []),
      },
      encomendas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      comunicados: { count: jest.fn(async () => 0) },
      apartamentos: { count: jest.fn(async () => 0) },
      moradores: { count: jest.fn(async () => 0) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => auditLogs) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    return { svc: new DashboardService(prisma), prisma };
  }

  it('aberta = tudo que não está Solucionado (igual ao app)', async () => {
    const { svc, prisma } = montar();
    const r = await svc.summary(1);
    expect(r.ocorrenciasPendentes).toBe(5);
    const abertas = prisma.ocorrencias.count.mock.calls.map((c: any[]) => c[0].where).find((w: any) => !w.OR);
    expect(abertas).toEqual({
      id_condominio: 1,
      status: { notIn: ['Solucionado', 'solucionado', 'Resolvida', 'resolvida'] },
    });
  });

  it('urgentes = abertas com prazo vencido ou prioridade crítica (1); 0 e 2 não acendem', async () => {
    const { svc, prisma } = montar();
    const r = await svc.summary(1);
    expect(r.ocorrenciasUrgentes).toBe(2);
    const urgentes = prisma.ocorrencias.count.mock.calls.map((c: any[]) => c[0].where).find((w: any) => w.OR);
    expect(urgentes.status).toEqual({ notIn: ['Solucionado', 'solucionado', 'Resolvida', 'resolvida'] });
    expect(urgentes.OR).toEqual([
      { prazo: { lt: expect.any(Date) } },
      { categoria: { prioridade: 1 } },
    ]);
  });

  it('status de dispositivo sai como "Dispositivo", não "Ocorrência"', async () => {
    const { svc } = montar([
      { id: 9, acao: 'OFFLINE', descricao: 'O dispositivo "Portão" ficou offline.', created_at: new Date() },
      { id: 10, acao: 'ONLINE', descricao: 'O dispositivo "Portão" voltou a ficar online.', created_at: new Date(Date.now() - 1000) },
    ]);
    const r = await svc.summary(1);
    const disp = r.ultimosEventos.filter((e) => e.detalhes.nome === 'Dispositivos');
    expect(disp).toHaveLength(2);
    expect(disp.every((e) => e.tipo === 'Dispositivo')).toBe(true);
    expect(disp.map((e) => e.detalhes.status)).toEqual(['Offline', 'Online']);
  });
});
