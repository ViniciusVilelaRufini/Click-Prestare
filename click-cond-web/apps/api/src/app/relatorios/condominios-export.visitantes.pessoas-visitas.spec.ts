import { CondominiosExportService } from './condominios-export.service';

const AdmZip = require('adm-zip');

/**
 * `gerarCsvVisitantesEPrestadores` (usada por `gerarPacoteExportacao`) lê
 * `Visitantes` incondicionalmente. Task "Lote C": migra para `Visitas`
 * (+`Pessoa`) sob a flag, achatando nome/documento de volta pro formato do
 * CSV.
 */
describe('CondominiosExportService — CSV de visitantes (Pessoas/Visitas)', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  function build() {
    const prisma: any = {
      condominios: { findUnique: jest.fn().mockResolvedValue({ id: 1, nome: 'Residencial Teste' }) },
      moradores: { findMany: jest.fn().mockResolvedValue([]) },
      veiculos: { findMany: jest.fn().mockResolvedValue([]) },
      visitantes: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 30,
            nome: 'Maria Visitante Legado',
            doc_identificacao: '98765432100',
            is_prestador: 0,
            data_entrada: new Date('2026-09-01T10:00:00Z'),
            data_saida: new Date('2026-09-01T12:00:00Z'),
            liberado: 1,
            bloqueado: 0,
            apartamento: { apto: '101', bloco: 'A' },
          },
        ]),
      },
      visitas: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 300,
            is_prestador: 0,
            data_entrada: new Date('2026-09-01T10:00:00Z'),
            data_saida: new Date('2026-09-01T12:00:00Z'),
            liberado: 1,
            bloqueado: 0,
            apartamento: { apto: '101', bloco: 'A' },
            pessoa: { nome: 'Maria Visitante Migrada', doc_identificacao: '98765432100' },
          },
        ]),
      },
      prestadores_servico: { findMany: jest.fn().mockResolvedValue([]) },
      encomendas: { findMany: jest.fn().mockResolvedValue([]) },
      ocorrencias: { findMany: jest.fn().mockResolvedValue([]) },
      acessos_Facial: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    return { svc: new CondominiosExportService(prisma), prisma };
  }

  it('flag OFF: CSV vem de Visitantes, Visitas nunca é consultada', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    const { svc, prisma } = build();
    const { buffer } = await svc.gerarPacoteExportacao(1);
    const zip = new AdmZip(buffer);
    const csv = zip.getEntry('visitantes_e_prestadores.csv')!.getData().toString('utf8');
    expect(csv).toContain('Maria Visitante Legado');
    expect(prisma.visitantes.findMany).toHaveBeenCalled();
    expect(prisma.visitas.findMany).not.toHaveBeenCalled();
  });

  it('flag ON: CSV vem de Visitas+Pessoa, Visitantes nunca é consultada', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const { svc, prisma } = build();
    const { buffer } = await svc.gerarPacoteExportacao(1);
    const zip = new AdmZip(buffer);
    const csv = zip.getEntry('visitantes_e_prestadores.csv')!.getData().toString('utf8');
    expect(csv).toContain('Maria Visitante Migrada');
    expect(prisma.visitas.findMany).toHaveBeenCalled();
    expect(prisma.visitantes.findMany).not.toHaveBeenCalled();
  });
});
