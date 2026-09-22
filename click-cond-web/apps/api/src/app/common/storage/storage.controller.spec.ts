import { ForbiddenException } from '@nestjs/common';
import { StorageController } from './storage.controller';

describe('StorageController', () => {
  it('blocks generic reads until entity-to-tenant authorization exists', () => {
    const controller = new StorageController();
    expect(() => controller.read()).toThrow(ForbiddenException);
  });
});
