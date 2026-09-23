import { ConflictException } from '@nestjs/common';
import { EncomendasService } from './encomendas.service';

describe('EncomendasService.receber', () => {
  it('recusa a segunda confirmaÃ§Ã£o da mesma encomenda sem reenviar notificaÃ§Ã£o', async () => {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findUnique: jest.fn(async () => ({ id_condominio: 1 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      users: { findMany: jest.fn(async () => []) },
    };
    const notifications: any = {
      sendPushNotification: jest.fn(),
      sendWhatsApp: jest.fn(),
    };
    const auditoria: any = { registrar: jest.fn() };
    const tenant: any = { assertEntidade: jest.fn(async () => {}) };
    const service = new EncomendasService(
      prisma,
      notifications,
      {} as any,
      auditoria,
      tenant,
    );

    await expect(
      service.receber(91, { sub: 8, nome: 'Porteiro QA', id_condominio: 1 } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.encomendas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 91, status: 'Esperando' } }),
    );
    expect(prisma.users.findMany).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
  });
});
