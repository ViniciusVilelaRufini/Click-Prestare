import { DashboardService } from './dashboard.service';

/**
 * `summary()` expõe `recebido_em` como `detalhes.dataEntrada` das encomendas.
 * `Esperando` (o morador só avisou) ainda não chegou: sem data de recebimento.
 */
describe('DashboardService — summary() dataEntrada das encomendas', () => {
  const recebido_em = new Date('2026-10-03T14:00:00Z');

  async function eventoEncomenda(status: string) {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
    const prisma: any = {
      isConnected: true,
      visitantes: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      visitas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      pessoas: { findMany: jest.fn(async () => []) },
      prestadores_servico: { count: jest.fn(async () => 0) },
      ocorrencias: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      encomendas: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => [
          {
            id: 7,
            descricao: 'Caixa dos Correios',
            destinatario_apto: '101',
            destinatario_bloco: 'A',
            recebido_de: null,
            recebido_em,
            retirado_em: null,
            retirado_por: null,
            status,
            recebidoPor: null,
            entreguePor: null,
          },
        ]),
      },
      comunicados: { count: jest.fn(async () => 0) },
      apartamentos: { count: jest.fn(async () => 0) },
      moradores: { count: jest.fn(async () => 0) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    const r = await new DashboardService(prisma).summary(1);
    const ev = r.ultimosEventos.find((e: any) => e.tipo === 'Encomenda');
    expect(ev).toBeDefined();
    return ev!;
  }

  it('Esperando (case-insensitive): dataEntrada nula', async () => {
    expect((await eventoEncomenda('Esperando')).detalhes.dataEntrada).toBeNull();
    expect((await eventoEncomenda('esperando')).detalhes.dataEntrada).toBeNull();
  });

  it('B6: a tendência de encomendas não conta pré-registro (Esperando)', async () => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];
    const findMany = jest.fn(async () => []);
    const vazio = { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) };
    const prisma: any = {
      isConnected: true,
      visitantes: vazio, visitas: vazio, pessoas: vazio, prestadores_servico: vazio, ocorrencias: vazio,
      encomendas: { count: jest.fn(async () => 0), findMany },
      comunicados: vazio, apartamentos: vazio, moradores: vazio, acessos_Facial: vazio, auditLog: vazio, facial_Devices: vazio,
    };
    await new DashboardService(prisma).summary(1);
    const tendencia = (findMany.mock.calls as any[]).map((c) => c[0]).find((a: any) => a?.where?.recebido_em?.gte);
    expect(tendencia.where.status).toEqual({ not: 'Esperando' });
  });

  it('Aguardando e Retirada: dataEntrada continua sendo recebido_em', async () => {
    expect((await eventoEncomenda('Aguardando')).detalhes.dataEntrada).toBe(recebido_em.toISOString());
    expect((await eventoEncomenda('Retirada')).detalhes.dataEntrada).toBe(recebido_em.toISOString());
  });
});
