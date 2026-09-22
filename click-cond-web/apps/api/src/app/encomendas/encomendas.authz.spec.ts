import { ForbiddenException } from '@nestjs/common';
import { EncomendasController } from './encomendas.controller';
import { EncomendasService } from './encomendas.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * These tests catch a missing authorization check before create side effects,
 * and a console list route that accepts a JWT without an operator role.
 */
describe('Encomendas authorization', () => {
  const dto = {
    descricao: 'Caixa',
    destinatario_apto: '101',
    id_condominio: 1,
    foto_volume: 'data:image/png;base64,AAAA',
  };
  const moradorTenant1: JwtPayload = { sub: 10, nome: 'Morador', id_condominio: 1 };

  function buildService() {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 1, ...dto })),
        findUnique: jest.fn(async () => null),
      },
      users: { findMany: jest.fn(async () => []) },
    };
    const notifications: any = {
      sendPushNotification: jest.fn(),
      sendWhatsApp: jest.fn(),
    };
    const storage: any = {
      isDataUrl: jest.fn(() => true),
      uploadDataUrl: jest.fn(async () => 'https://storage.test/encomenda.png'),
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const tenant: any = {
      assertCondominio: jest.fn(async () => {
        throw new ForbiddenException();
      }),
    };
    const service = new EncomendasService(prisma, notifications, storage, auditoria, tenant);
    return { service, prisma, notifications, storage, tenant };
  }

  it('rejects creating an encomenda for a tenant not linked to the JWT before side effects', async () => {
    const { service, prisma, notifications, storage, tenant } = buildService();

    await expect(service.create({ ...dto, id_condominio: 2 }, moradorTenant1))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect(tenant.assertCondominio).toHaveBeenCalledWith(2, moradorTenant1);
    expect(storage.isDataUrl).not.toHaveBeenCalled();
    expect(storage.uploadDataUrl).not.toHaveBeenCalled();
    expect(prisma.encomendas.findFirst).not.toHaveBeenCalled();
    expect(prisma.encomendas.create).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    expect(notifications.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('requires an operator for the console list endpoint', () => {
    const service: any = { findAll: jest.fn() };
    const controller = new EncomendasController(service);

    expect(() => controller.list(1, undefined as any, undefined)).toThrow(ForbiddenException);
    expect(service.findAll).not.toHaveBeenCalled();
  });
});
