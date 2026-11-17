import { ServiceUnavailableException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

describe('registerCondominio', () => {
  function build(vinculoCreate: jest.Mock, condCreate?: jest.Mock) {
    const tx: any = {
      endereco: { create: jest.fn(async () => ({ id: 1 })) },
      condominios: { create: condCreate ?? jest.fn(async () => ({ id: 9, nome: 'X' })) },
      sindicos_Condominios: { create: vinculoCreate },
    };
    const prisma: any = {
      isConnected: true,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const service = new MobileAuthService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, prisma, tx };
  }
  const body = { condominio: { nome: 'X' }, address: { cep: '1' } };

  it('erro do banco não devolve success:true', async () => {
    const { service, tx } = build(jest.fn(), jest.fn(async () => { throw new Error('db caiu'); }));
    await expect(service.registerCondominio(body, 5)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tx.sindicos_Condominios.create).not.toHaveBeenCalled();
  });

  it('falha no vínculo do síndico dentro da transação vira 503', async () => {
    const { service, prisma } = build(jest.fn(async () => { throw new Error('fk'); }));
    await expect(service.registerCondominio(body, 5)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('caminho feliz devolve success, id e nome', async () => {
    const { service, tx } = build(jest.fn(async () => ({})));
    await expect(service.registerCondominio(body, 5)).resolves.toEqual({ success: true, id: 9, nome: 'X' });
    expect(tx.sindicos_Condominios.create).toHaveBeenCalledWith({ data: { id_user: 5, id_condominio: 9 } });
  });
});
