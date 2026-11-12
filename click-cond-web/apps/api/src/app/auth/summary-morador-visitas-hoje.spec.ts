import { MobileAuthService } from './mobile-auth.service';

/**
 * O card "Visitas hoje · Agendadas para hoje" contava também quem entrou dias
 * atrás e não saiu (data_entrada não nula + data_saida nula). Quem está dentro
 * já tem contagem própria (inside_condo).
 */
describe('getSummary (morador) — visitas de hoje', () => {
  const envOriginal = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeAll(() => { process.env['PESSOAS_MIGRATION_ENABLED'] = 'true'; });
  afterAll(() => { process.env['PESSOAS_MIGRATION_ENABLED'] = envOriginal; });

  it('where de visits não inclui "entrou e não saiu" de dias anteriores', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: { findMany: jest.fn().mockResolvedValue([{ id_apto: 7 }]) },
      visitas: { count },
      pessoas: {},
      moradores: { findMany: jest.fn().mockResolvedValue([]) },
      encomendas: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = Object.create(MobileAuthService.prototype) as any;
    svc.prisma = prisma;

    await svc.getSummary(41, 'Morador');

    const where = count.mock.calls[0][0].where;
    expect(where.id_apartamento).toEqual({ in: [7] });
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toEqual({ data_entrada: { gte: expect.any(Date), lte: expect.any(Date) } });
    expect(where.OR[1]).toEqual({ data_hora_inicio: { gte: expect.any(Date), lte: expect.any(Date) } });
    expect(JSON.stringify(where)).not.toContain('data_saida');
    // inside_condo continua contando quem está dentro, de qualquer dia.
    expect(count.mock.calls[1][0].where).toEqual({
      id_apartamento: { in: [7] }, data_entrada: { not: null }, data_saida: null,
    });
  });
});
