import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * A foto do documento (RG) do visitante é dado sensível: o painel só a envia
 * quando quem pede é síndico. Para o porteiro o campo vem AUSENTE (não nulo,
 * não vazio) — e `fotoPessoa` continua indo para todos.
 */
describe('Dashboard — fotoDocumento só para síndico', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const comum = {
      is_prestador: 0,
      data_entrada: new Date('2026-01-01T10:00:00Z'),
      data_saida: new Date('2026-01-01T12:00:00Z'),
      created_at: new Date('2026-01-01T09:00:00Z'),
      apartamento: { bloco: 'A', apto: '101' },
      criadoPor: { name: 'Morador Teste' },
    };
    const visitanteLegado = {
      ...comum, id: 1, nome: 'Carlos Visitante', doc_identificacao: '999',
      foto_pessoa: 'rosto.jpg', foto_documento: 'rg.jpg',
    };
    const visitaMigrada = {
      ...comum, id: 501,
      pessoa: {
        id: 800, nome: 'Carlos Visitante', doc_identificacao: '999',
        foto_pessoa: 'rosto.jpg', foto_documento: 'rg.jpg', tipo_pessoa: 'visitante',
      },
    };
    const prisma: any = {
      isConnected: true,
      visitantes: { count: jest.fn(async () => 1), findMany: jest.fn(async () => [visitanteLegado]) },
      visitas: { count: jest.fn(async () => 1), findMany: jest.fn(async () => [visitaMigrada]) },
      pessoas: { findMany: jest.fn(async () => []) },
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
    return new DashboardService(prisma);
  }

  const doCarlos = (r: any) => r.ultimosEventos.filter((e: any) => e.detalhes.nome === 'Carlos Visitante');

  describe.each([
    ['legado', 'false'],
    ['migrado', 'true'],
  ])('caminho %s', (_nome, flag) => {
    it('sem dizer o papel (padrão): campo ausente na entrada e na saída', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
      const r = await build().summary(1);
      const eventos = doCarlos(r);
      expect(eventos).toHaveLength(2);
      for (const ev of eventos) {
        expect(ev.detalhes).not.toHaveProperty('fotoDocumento');
        expect(ev.detalhes.fotoPessoa).toBe('rosto.jpg');
      }
      expect(JSON.stringify(r)).not.toContain('rg.jpg');
    });

    it('não-síndico explícito: campo ausente', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
      const r = await build().summary(1, { incluirFotoDocumento: false });
      for (const ev of doCarlos(r)) expect(ev.detalhes).not.toHaveProperty('fotoDocumento');
      expect(JSON.stringify(r)).not.toContain('rg.jpg');
    });

    it('síndico: recebe fotoDocumento na entrada e na saída', async () => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = flag;
      const r = await build().summary(1, { incluirFotoDocumento: true });
      const eventos = doCarlos(r);
      expect(eventos).toHaveLength(2);
      for (const ev of eventos) {
        expect(ev.detalhes.fotoDocumento).toBe('rg.jpg');
        expect(ev.detalhes.fotoPessoa).toBe('rosto.jpg');
      }
    });
  });

  describe('controller decide pelo papel do token', () => {
    const chamar = async (user: any) => {
      const service: any = { summary: jest.fn(async () => ({})) };
      await new DashboardController(service).get(1, user);
      return service.summary.mock.calls[0];
    };

    it('porteiro: pede sem a foto do documento', async () => {
      expect(await chamar({ sub: 3, nome: 'Porteiro', id_condominio: 1, turno: 'Diurno' })).toEqual([
        1, { incluirFotoDocumento: false },
      ]);
    });

    it('síndico do app (typeAccess): pede com a foto', async () => {
      expect(await chamar({ sub: 11, nome: 'Síndico', typeAccess: 'Sindico' })).toEqual([
        1, { incluirFotoDocumento: true },
      ]);
    });

    it('síndico do console (turno "Síndico"): pede com a foto', async () => {
      expect(await chamar({ sub: 13, nome: 'Síndico Web', id_condominio: 1, turno: 'Síndico' })).toEqual([
        1, { incluirFotoDocumento: true },
      ]);
    });
  });
});
