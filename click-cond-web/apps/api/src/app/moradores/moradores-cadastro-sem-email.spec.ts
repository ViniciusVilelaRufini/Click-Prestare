import { MoradoresService } from './moradores.service';

/**
 * M1: "Enviar credenciais" vem marcado por padrão no console e a importação manda sendCredentials
 * true. Sem e-mail nenhuma conta de app é criada, então a data de nascimento não pode ser exigida.
 */
describe('MoradoresService.create — sem e-mail não exige data de nascimento (M1)', () => {
  function harness() {
    const prisma: any = {
      isConnected: true,
      apartamentos: {
        findUnique: jest.fn().mockResolvedValue({ id: 10, id_condominio: 1, bloco: 'A', apto: '101' }),
        findFirst: jest.fn().mockResolvedValue({ id: 10, id_condominio: 1, bloco: 'A', apto: '101' }),
      },
      users: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 99 }) },
      funcionarios_Portaria: { count: jest.fn().mockResolvedValue(0) },
      apartamentos_Users: { create: jest.fn().mockResolvedValue({}) },
      moradores: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
        findUnique: jest.fn().mockResolvedValue({ id: 1, nome: 'X', id_user: 99, user: { photo: null, apartamentosUsers: [] } }),
      },
      visitantes: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const mail: any = { sendWelcomeMorador: jest.fn().mockResolvedValue({}), sendWelcomeMoradorExisting: jest.fn().mockResolvedValue({}) };
    const storage: any = { isDataUrl: () => false, exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const service = new MoradoresService(
      prisma,
      mail,
      storage,
      { syncMorador: jest.fn().mockResolvedValue({}) } as any,
      { registrar: jest.fn().mockResolvedValue({}) } as any,
      { enviarMorador: jest.fn().mockResolvedValue({ enviado: false }) } as any,
    );
    return { service, prisma, mail };
  }

  it('aceita nome e unidade com "Enviar credenciais" marcado e sem e-mail', async () => {
    const { service, prisma, mail } = harness();
    await expect(
      service.create({ nome: 'Só Nome', id_apartamento: 10, id_condominio: 1, sendCredentials: true } as any),
    ).resolves.toBeDefined();
    expect(prisma.moradores.create).toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  });

  it('importação: linha sem e-mail e sem nascimento entra (sendCredentials vem true por padrão)', async () => {
    const { service } = harness();
    const r = await service.importBulk(1, [{ nome: 'Linha Sem Email', bloco: 'A', apto: '101' }]);
    expect(r.erros).toHaveLength(0);
    expect(r.total).toBe(1);
  });
});
