import { DashboardService } from './dashboard.service';

/**
 * `summary()` conta visitantes ainda no condomínio e lista as 15
 * entradas/saídas mais recentes. Task "Lote C": essas três leituras migram
 * para `Visitas`/`Pessoas` sob a flag, achatando `pessoa` de volta pro
 * formato que o resto do método (nome/doc/foto na raiz) já espera.
 */
describe('DashboardService — summary() (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const visitanteLegado = {
      id: 1,
      nome: 'Carlos Visitante',
      doc_identificacao: '999',
      foto_pessoa: 'foto.jpg',
      foto_documento: null,
      is_prestador: 0,
      data_entrada: new Date('2026-01-01T10:00:00Z'),
      data_saida: null,
      created_at: new Date('2026-01-01T09:00:00Z'),
      apartamento: { bloco: 'A', apto: '101' },
      criadoPor: { name: 'Morador Teste' },
    };
    const visitaMigrada = {
      id: 501,
      is_prestador: 0,
      data_entrada: new Date('2026-01-01T10:00:00Z'),
      data_saida: null,
      created_at: new Date('2026-01-01T09:00:00Z'),
      apartamento: { bloco: 'A', apto: '101' },
      criadoPor: { name: 'Morador Teste' },
      pessoa: { nome: 'Carlos Visitante', doc_identificacao: '999', foto_pessoa: 'foto.jpg', foto_documento: null },
    };

    const prisma: any = {
      isConnected: true,
      visitantes: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [visitanteLegado]),
      },
      visitas: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [visitaMigrada]),
      },
      prestadores_servico: { count: jest.fn(async () => 0) },
      ocorrencias: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      encomendas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      comunicados: { count: jest.fn(async () => 0) },
      apartamentos: { count: jest.fn(async () => 5) },
      moradores: { count: jest.fn(async () => 10) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    const svc = new DashboardService(prisma);
    return { svc, prisma };
  }

  it('flag OFF: conta e lista contra Visitantes, nunca toca Visitas', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const r = await svc.summary(1);
    expect(r.visitantesAtivos).toBe(1);
    expect(prisma.visitantes.count).toHaveBeenCalled();
    expect(prisma.visitantes.findMany).toHaveBeenCalled();
    expect(prisma.visitas.count).not.toHaveBeenCalled();
    expect(prisma.visitas.findMany).not.toHaveBeenCalled();

    const entrada = r.ultimosEventos.find((e) => e.detalhes.nome === 'Carlos Visitante');
    expect(entrada).toBeDefined();
    expect(entrada!.detalhes.documento).toBe('999');
  });

  it('flag ON: conta e lista contra Visitas+Pessoa, nunca toca Visitantes, e achata nome/doc corretamente', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    const r = await svc.summary(1);
    expect(r.visitantesAtivos).toBe(1);
    expect(prisma.visitas.count).toHaveBeenCalled();
    expect(prisma.visitas.findMany).toHaveBeenCalled();
    expect(prisma.visitantes.count).not.toHaveBeenCalled();
    expect(prisma.visitantes.findMany).not.toHaveBeenCalled();

    const entrada = r.ultimosEventos.find((e) => e.detalhes.nome === 'Carlos Visitante');
    expect(entrada).toBeDefined();
    expect(entrada!.detalhes.documento).toBe('999');
    expect(entrada!.detalhes.blocoApto).toContain('101');
  });
});
