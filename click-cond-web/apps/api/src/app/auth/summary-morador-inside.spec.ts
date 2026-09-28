import { MobileAuthService } from './mobile-auth.service';

/**
 * O resumo do morador não trazia quem está dentro agora; o app caía no
 * fallback de "visitas do dia" e o card dizia "2 no local" com 1 pessoa dentro.
 */
describe('getSummary (morador) — inside_condo', () => {
  const envOriginal = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeAll(() => { process.env['PESSOAS_MIGRATION_ENABLED'] = 'true'; });
  afterAll(() => { process.env['PESSOAS_MIGRATION_ENABLED'] = envOriginal; });

  it('conta só visitas com entrada e sem saída', async () => {
    const count = jest.fn()
      .mockResolvedValueOnce(2) // visitas do dia
      .mockResolvedValueOnce(1); // dentro agora
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

    const r = await svc.getSummary(41, 'Morador');

    expect(r.inside_condo).toBe(1);
    expect(r.visits).toBe(2);
    expect(count.mock.calls[1][0]).toEqual({
      where: { id_apartamento: { in: [7] }, data_entrada: { not: null }, data_saida: null },
    });
  });
});
