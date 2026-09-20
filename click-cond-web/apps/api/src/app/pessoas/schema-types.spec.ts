import { PrismaClient } from '../prisma/generated';
import { PrismaService } from '../prisma/prisma.service';

describe('Prisma Schema: Pessoas e Visitas', () => {
  it('deve exportar delegates para pessoas e visitas no PrismaClient e PrismaService', () => {
    const prisma = new PrismaClient();
    expect((prisma as any).pessoas).toBeDefined();
    expect((prisma as any).visitas).toBeDefined();

    const service = new PrismaService();
    expect((service as any).pessoas).toBeDefined();
    expect((service as any).visitas).toBeDefined();
  });
});
