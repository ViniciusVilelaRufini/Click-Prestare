import { RelatoriosService } from './relatorios.service';

/**
 * Três leituras de `RelatoriosService` que ainda liam `Visitantes`
 * incondicionalmente (task "Lote C"):
 *  - `generate('visitantes', 'xlsx', ...)` — relatório de visitantes.
 *  - `getEventos()` — feed de eventos (entradas/saídas de visitantes).
 *  - a correlação `Acessos_Facial.id_pessoa` → visitante (nome/foto/apto)
 *    dentro de `getEventos()`, que precisa do merge Pessoas+Visitas porque
 *    esse id não tem espaço único no caminho migrado.
 */
describe('RelatoriosService — leituras de visitantes (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const visitanteLegado = {
      id: 30,
      nome: 'Maria Legado',
      doc_identificacao: '98765432100',
      is_prestador: 0,
      data_entrada: new Date('2026-09-01T10:00:00Z'),
      data_saida: null,
      created_at: new Date('2026-09-01T09:00:00Z'),
      apartamento: { apto: '101', bloco: 'A' },
      criadoPor: { name: 'Morador Teste' },
    };
    const visitaMigrada = {
      id: 300,
      is_prestador: 0,
      data_entrada: new Date('2026-09-01T10:00:00Z'),
      data_saida: null,
      created_at: new Date('2026-09-01T09:00:00Z'),
      apartamento: { apto: '101', bloco: 'A' },
      criadoPor: { name: 'Morador Teste' },
      pessoa: { nome: 'Maria Migrada', doc_identificacao: '98765432100', foto_pessoa: null, foto_documento: null },
    };

    const prisma: any = {
      isConnected: true,
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Condomínio Teste' })) },
      visitantes: {
        findMany: jest.fn(async () => [visitanteLegado]),
      },
      visitas: {
        findMany: jest.fn(async () => [visitaMigrada]),
      },
      pessoas: {
        findMany: jest.fn(async () => []),
      },
      encomendas: { findMany: jest.fn(async () => []) },
      ocorrencias: { findMany: jest.fn(async () => []) },
      acessos_Facial: { findMany: jest.fn(async () => []) },
      auditLog: { findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    return { svc: new RelatoriosService(prisma), prisma, visitanteLegado, visitaMigrada };
  }

  describe('generate("visitantes")', () => {
    it('flag OFF: lê Visitantes e nunca toca Visitas', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { svc, prisma } = build();
      const { buffer } = await svc.generate(1, 'visitantes', 'xlsx');
      expect(buffer.length).toBeGreaterThan(0);
      expect(prisma.visitantes.findMany).toHaveBeenCalled();
      expect(prisma.visitas.findMany).not.toHaveBeenCalled();
    });

    it('flag ON: lê Visitas+Pessoa e nunca toca Visitantes', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = build();
      const { buffer } = await svc.generate(1, 'visitantes', 'xlsx');
      expect(buffer.length).toBeGreaterThan(0);
      expect(prisma.visitas.findMany).toHaveBeenCalled();
      expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getEventos()', () => {
    it('flag OFF: entradas/saídas vêm de Visitantes, nunca toca Visitas', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
      const { svc, prisma } = build();
      const r = await svc.getEventos(1);
      const item = r.items.find((i: any) => i.detalhes?.nome === 'Maria Legado');
      expect(item).toBeDefined();
      expect(prisma.visitantes.findMany).toHaveBeenCalled();
      expect(prisma.visitas.findMany).not.toHaveBeenCalled();
    });

    it('flag ON: entradas/saídas vêm de Visitas+Pessoa, nunca toca Visitantes', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = build();
      const r = await svc.getEventos(1);
      const item = r.items.find((i: any) => i.detalhes?.nome === 'Maria Migrada');
      expect(item).toBeDefined();
      expect(prisma.visitas.findMany).toHaveBeenCalled();
      expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
    });

    it('flag ON: correlação de Acessos_Facial.id_pessoa faz merge Pessoas+Visitas (um id de cada espaço)', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
      const { svc, prisma } = build();

      // Dois acessos faciais tipo "visitante": um com id_pessoa apontando
      // pra uma Pessoa (id 900), outro apontando pra uma Visita (id 901) —
      // a mesma ambiguidade documentada no código.
      prisma.acessos_Facial.findMany = jest.fn(async () => [
        {
          id: 1, id_condominio: 1, timestamp: new Date('2026-09-05T08:00:00Z'),
          nome_pessoa: 'Pessoa Direta', tipo_pessoa: 'visitante', tipo_dispositivo: 'facial',
          evento: 'entrada', confianca: 0.9, id_device: 1, id_pessoa: 900,
        },
        {
          id: 2, id_condominio: 1, timestamp: new Date('2026-09-05T09:00:00Z'),
          nome_pessoa: 'Visita Direta', tipo_pessoa: 'visitante', tipo_dispositivo: 'facial',
          evento: 'entrada', confianca: 0.9, id_device: 1, id_pessoa: 901,
        },
      ]);
      prisma.pessoas.findMany = jest.fn(async ({ where }: any) =>
        where.id.in.includes(900)
          ? [{ id: 900, foto_pessoa: 'foto-pessoa.jpg', doc_identificacao: 'doc-pessoa' }]
          : [],
      );
      prisma.visitas.findMany.mockImplementation(async (args: any) => {
        // A mesma delegate serve tanto getEventos (entradas/saídas) quanto o
        // merge de correlação — diferencia pelo shape do `where`.
        if (args?.where?.id?.in) {
          return args.where.id.in.includes(901)
            ? [{
                id: 901,
                apartamento: { bloco: 'B', apto: '202' },
                pessoa: { foto_pessoa: 'foto-visita.jpg', doc_identificacao: 'doc-visita' },
              }]
            : [];
        }
        return [];
      });

      const r = await svc.getEventos(1);
      const viaPessoa = r.items.find((i: any) => i.detalhes?.nome === 'Pessoa Direta');
      const viaVisita = r.items.find((i: any) => i.detalhes?.nome === 'Visita Direta');
      expect(viaPessoa).toBeDefined();
      expect(viaPessoa!.detalhes.documento).toBe('doc-pessoa');
      expect(viaVisita).toBeDefined();
      expect(viaVisita!.detalhes.documento).toBe('doc-visita');
      expect(viaVisita!.detalhes.blocoApto).toContain('202');
    });
  });
});
