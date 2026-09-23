import { ConflictException } from '@nestjs/common';
import { EncomendasService } from './encomendas.service';

describe('EncomendasService.retirar', () => {
  it('recusa segunda retirada sem sobrescrever comprovantes ou duplicar auditoria', async () => {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const auditoria: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: jest.fn(() => false) };
    const tenant: any = { assertEntidade: jest.fn(async () => {}) };
    const service = new EncomendasService(
      prisma,
      {} as any,
      storage,
      auditoria,
      tenant,
    );

    await expect(
      service.retirar(44, 'Morador QA', undefined, undefined, 'foto-antiga', {
        sub: 7,
        nome: 'Porteiro QA',
        id_condominio: 1,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.encomendas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 44, status: 'Aguardando' } }),
    );
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});
