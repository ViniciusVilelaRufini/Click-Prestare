import { MoradoresService } from './moradores.service';

/**
 * O cadastro pelo console gravava o telefone só em Users: o registro de
 * Moradores ficava com telefone nulo, a coluna "Contato" mostrava "—" e a
 * tela de edição abria sem o telefone.
 */
describe('MoradoresService.create — telefone', () => {
  it('grava o telefone também em Moradores', async () => {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 46 }),
      },
      users: { create: jest.fn().mockResolvedValue({ id: 45 }) },
      apartamentos: { findUnique: jest.fn().mockResolvedValue({ id: 7, bloco: 'Bloco A', apto: '106' }) },
      apartamentos_Users: { create: jest.fn().mockResolvedValue({}) },
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

    await service
      .create({
        nome: 'Teste Telefone',
        telefone: '17991234568',
        tipo: 'inquilino',
        id_apartamento: 7,
        id_condominio: 1,
        data_nascimento: '10/05/1990',
      } as any)
      .catch(() => undefined);

    expect(prisma.moradores.create).toHaveBeenCalled();
    expect(prisma.moradores.create.mock.calls[0][0].data.telefone).toBe('17991234568');
  });
});
