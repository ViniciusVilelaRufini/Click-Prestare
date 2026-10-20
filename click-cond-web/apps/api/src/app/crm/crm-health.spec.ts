import { CrmService } from './crm.service';

/**
 * GET /crm/health é público (health check de infraestrutura). Ele devolvia o
 * total de condomínios da plataforma — o tamanho da carteira de clientes para
 * qualquer um que chamasse. O health só precisa dizer se o banco responde.
 */
describe('CrmService.healthCheck — não expõe dados de negócio', () => {
  it('com banco conectado mede a latência sem contar condomínios', async () => {
    const prisma: any = {
      isConnected: true,
      $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      condominios: { count: jest.fn().mockResolvedValue(42) },
    };
    const service = Object.create(CrmService.prototype);
    (service as any).prisma = prisma;

    const h = await service.healthCheck();

    expect(h.connected).toBe(true);
    expect(h).not.toHaveProperty('totalCondominios');
    expect(prisma.condominios.count).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});
