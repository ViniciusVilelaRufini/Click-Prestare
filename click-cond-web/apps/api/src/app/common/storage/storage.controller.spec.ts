import { ForbiddenException } from '@nestjs/common';
import { StorageController } from './storage.controller';

describe('StorageController', () => {
  const user = { id: 7, id_empresa: 3, email: 'user@example.test' };

  it('denies a private-object read before accessing object storage when the tenant is unauthorized', async () => {
    const storage = { getPrivateObject: jest.fn() };
    const tenantAccess = {
      assertCondominio: jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const controller = new StorageController(storage as any, tenantAccess as any);
    const response = { setHeader: jest.fn() };

    await expect(
      controller.read('moradores/opaque-object-key.jpg', 123, user as any, response as any),
    ).rejects.toThrow(ForbiddenException);

    expect(tenantAccess.assertCondominio).toHaveBeenCalledWith(123, user);
    expect(storage.getPrivateObject).not.toHaveBeenCalled();
  });
});
