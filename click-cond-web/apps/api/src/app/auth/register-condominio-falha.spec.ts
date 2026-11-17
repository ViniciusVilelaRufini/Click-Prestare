import { ServiceUnavailableException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

describe('registerCondominio — falha', () => {
  it('erro do banco não devolve success:true', async () => {
    const prisma: any = {
      isConnected: true,
      endereco: { create: jest.fn(async () => ({ id: 1 })) },
      condominios: { create: jest.fn(async () => { throw new Error('db caiu'); }) },
      sindicos_Condominios: { create: jest.fn() },
    };
    const service = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(
      service.registerCondominio({ condominio: { nome: 'X' }, address: { cep: '1' } }, 5),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.sindicos_Condominios.create).not.toHaveBeenCalled();
  });
});
