import { MoradoresService } from './moradores.service';

/** Mesma regra no cadastro do console (e no import-bulk, que chama create por linha). */
describe('MoradoresService.create — conta existente com vínculo em outro condomínio', () => {
  const MSG = 'Não foi possível concluir o cadastro com este e-mail/CPF. Peça para a pessoa vincular a unidade pelo próprio app ou fale com o suporte.';
  const existente = { id: 70, email: 'v@x.com', login: null, password: '$2b$10$senhaDaVitima', photo: null };

  function build(vinculoFora: boolean) {
    const contaFora = jest.fn(async ({ where }: any) => (vinculoFora && where.id_condominio?.not !== undefined ? 1 : 0));
    const prisma: any = {
      isConnected: true,
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 300, ...data })),
        count: contaFora,
      },
      visitantes: { findFirst: jest.fn(async () => null) },
      users: {
        findFirst: jest.fn(async () => ({ ...existente })),
        create: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      apartamentos: { findUnique: jest.fn(async () => null) },
      apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new MoradoresService(prisma, mail, storage, {} as any, { registrar: jest.fn(async () => ({})) } as any, { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any);
    jest.spyOn(svc as any, 'carregarContextoMorador').mockResolvedValue(null);
    jest.spyOn(svc, 'findOne').mockResolvedValue({} as any);
    return { svc, prisma, mail };
  }

  const dto = { nome: 'V', email: 'v@x.com', data_nascimento: '1990-01-01', id_condominio: 1, sendCredentials: true };

  it('RECUSA ligar a conta de outro condomínio: nada gravado, nenhum e-mail', async () => {
    const { svc, prisma, mail } = build(true);
    await expect(svc.create(dto as any)).rejects.toThrow(MSG);
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMoradorExisting).not.toHaveBeenCalled();
  });

  it('conta só deste condomínio continua recebendo login/senha', async () => {
    const { svc, prisma } = build(false);
    await svc.create(dto as any);
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 70 },
      data: expect.objectContaining({ login: 'v@x.com', password: expect.stringMatching(/^\$2/) }),
    });
  });
});
