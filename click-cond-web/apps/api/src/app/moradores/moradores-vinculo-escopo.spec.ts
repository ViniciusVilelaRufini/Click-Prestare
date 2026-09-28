import { MoradoresService } from './moradores.service';

/**
 * Editar o apartamento de um morador apagava TODOS os vínculos do usuário
 * (`deleteMany({ where: { id_user } })`) — inclusive os de outros
 * condomínios. Quem mora em dois prédios, ou o síndico vinculado a uma
 * unidade em outro, perdia o acesso lá ao ser editado aqui.
 */
describe('MoradoresService.update — troca de apartamento', () => {
  it('só remove os vínculos do condomínio do morador', async () => {
    const tx: any = {
      apartamentos_Users: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
      apartamentos: { findUnique: jest.fn().mockResolvedValue({ id: 7, bloco: 'A', apto: '106', id_condominio: 1 }) },
      moradores: { update: jest.fn().mockResolvedValue({ id: 43, id_user: 41, id_condominio: 1 }) },
      users: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      isConnected: true,
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      moradores: {
        findUnique: jest.fn().mockResolvedValue({ id: 43, id_user: 41, id_condominio: 1, tipo: 'proprietario', nome: 'X' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      users: { findUnique: jest.fn().mockResolvedValue({ id: 41 }), update: jest.fn().mockResolvedValue({}) },
      facial_Devices: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new MoradoresService(
      prisma,
      {} as any,
      { isDataUrl: jest.fn().mockReturnValue(false), uploadDataUrl: jest.fn() } as any,
      { syncMorador: jest.fn().mockResolvedValue({}) } as any,
      { registrar: jest.fn().mockResolvedValue({}) } as any,
      { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
    );
    jest.spyOn(service as any, 'assertCredencialDisponivel').mockResolvedValue(undefined);

    await service.update(43, { id_apartamento: 7 } as any).catch(() => undefined);

    expect(tx.apartamentos_Users.deleteMany).toHaveBeenCalledWith({
      where: { id_user: 41, apartamento: { id_condominio: 1 } },
    });
  });
});
