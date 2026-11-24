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
    const storage: any = { isDataUrl: jest.fn(() => false), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
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
      expect.objectContaining({ where: { id: 44, status: { in: ['Aguardando', 'Esperando'] } } }),
    );
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  // C3: o app do staff oferece "Dar Baixa" na encomenda pré-registrada pelo
  // morador ('Esperando', ex.: iFood) e não tem "Receber"; a API só aceitava
  // 'Aguardando' e respondia 409.
  it.each(['Aguardando', 'Esperando'])('dá baixa em encomenda %s', async (status) => {
    const linha: any = { id: 45, id_condominio: 1, descricao: 'Pacote', status };
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findUnique: jest.fn(async () => ({ ...linha })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const casa = where.status?.in ? where.status.in.includes(linha.status) : where.status === linha.status;
          if (!casa) return { count: 0 };
          Object.assign(linha, data);
          return { count: 1 };
        }),
      },
    };
    const auditoria: any = { registrar: jest.fn() };
    const storage: any = { isDataUrl: jest.fn(() => false), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const tenant: any = { assertEntidade: jest.fn(async () => {}) };
    const service = new EncomendasService(prisma, {} as any, storage, auditoria, tenant);
    jest.spyOn(service as any, 'carregarContextoEncomenda').mockResolvedValue(null);

    const r: any = await service.retirar(45, 'Morador QA', undefined, undefined, undefined, {
      sub: 7,
      nome: 'Porteiro QA',
      id_condominio: 1,
    } as any);

    expect(r.status).toBe('Retirada');
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('não dá baixa em encomenda já retirada', async () => {
    const prisma: any = {
      isConnected: true,
      encomendas: {
        findUnique: jest.fn(async () => ({ id: 46, id_condominio: 1, status: 'Retirada' })),
        updateMany: jest.fn(async ({ where }: any) => ({ count: where.status?.in?.includes('Retirada') ? 1 : 0 })),
      },
    };
    const storage: any = { isDataUrl: jest.fn(() => false), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const service = new EncomendasService(prisma, {} as any, storage, { registrar: jest.fn() } as any, { assertEntidade: jest.fn() } as any);
    await expect(service.retirar(46, 'X', undefined, undefined, undefined, { sub: 7, id_condominio: 1 } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
