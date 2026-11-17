import { ConflictException } from '@nestjs/common';
import { ApartamentosService } from './apartamentos.service';

describe('ApartamentosService — unidade igual não duplica', () => {
  function build(existentes: any[]) {
    const tenant = {
      assertCondominio: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findMany: jest.fn(async () => existentes),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 99, ...data })),
      },
    };
    const service = new ApartamentosService(prisma, tenant as any, { registrar: jest.fn() } as any);
    return { service, prisma };
  }
  const sindico: any = { sub: 1, typeAccess: 'Sindico', user: { id: 1 } };

  it('create recusa "Bloco A"/101 quando já existe A/101', async () => {
    const { service, prisma } = build([{ id: 1, bloco: 'A', apto: '101' }]);
    await expect(service.create({ id_condominio: 2, bloco: 'Bloco A', apto: '101' } as any, sindico)).rejects.toThrow(
      new ConflictException('Essa unidade já existe (A 101).'),
    );
    expect(prisma.apartamentos.create).not.toHaveBeenCalled();
  });

  it('create aceita unidade nova', async () => {
    const { service, prisma } = build([{ id: 1, bloco: 'A', apto: '101' }]);
    await service.create({ id_condominio: 2, bloco: 'B', apto: '101' } as any, sindico);
    expect(prisma.apartamentos.create).toHaveBeenCalled();
  });

  it('importBulk ignora a unidade repetida com motivo e repetida dentro da própria planilha', async () => {
    const { service, prisma } = build([{ id: 1, bloco: 'A', apto: '101' }]);
    const r: any = await service.importBulk(
      2,
      [{ bloco: 'Bloco A', apto: '101' }, { bloco: 'B', apto: '5' }, { bloco: 'Bloco B', apto: '0005' }],
      sindico,
    );
    expect(prisma.apartamentos.create).toHaveBeenCalledTimes(1);
    expect(r.total).toBe(1);
    expect(r.ignorados).toEqual([
      expect.objectContaining({ apto: '101', motivo: 'Unidade já cadastrada' }),
      expect.objectContaining({ apto: '0005', motivo: 'Unidade já cadastrada' }),
    ]);
  });
});
