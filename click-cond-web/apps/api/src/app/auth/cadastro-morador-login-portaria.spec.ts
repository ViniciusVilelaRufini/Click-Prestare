import { MobileAuthService } from './mobile-auth.service';

/**
 * Users.login e Funcionarios_Portaria.login são ligados só por texto. O cadastro de morador pelo app gravava
 * `Users.login = e-mail do morador` (conta nova, ou conta existente sem login) sem conferir se esse e-mail já
 * era login de portaria — a conta nova passava a ser tratada como a do porteiro pelo loginFuncionario.
 */
describe('saveMorador (criação) — e-mail do morador × logins da portaria', () => {
  const MSG = 'Já existe outro usuário com este e-mail.';
  const sindico = { sub: 1, nome: 'Síndico A', typeAccess: 'Sindico' } as any;
  const portarias = [{ id: 70, login: 'porteiro@x.com', email: 'porteiro@x.com' }];

  function montar(conta: any = null) {
    const prisma: any = {
      isConnected: true,
      apartamentos: { findUnique: jest.fn(async () => ({ id: 11, id_condominio: 1, bloco: 'A', apto: '101' })) },
      moradores: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 500, ...data })),
        count: jest.fn(async () => 0),
      },
      users: {
        findFirst: jest.fn(async () => (conta ? { ...conta } : null)),
        create: jest.fn(async ({ data }: any) => ({ id: 900, ...data })),
        update: jest.fn(async () => ({})),
      },
      apartamentos_Users: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) =>
          portarias.find((p) =>
            (where.OR ?? []).some(
              (c: any) => c.login?.toLowerCase() === p.login || c.email?.toLowerCase() === p.email,
            ),
          ) ?? null,
        ),
      },
    };
    const mail: any = { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const superlogica: any = { enviarMorador: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn() } as any, mail, storage, {} as any, tenant, {} as any, {} as any, {} as any, superlogica);
    return { svc, prisma, mail };
  }

  const corpo = (email: string, extra: any = {}) => ({
    morador: { nome: 'Novo', email, data_nascimento: '01/01/1990', id_apto: 11, sendCredentials: false, ...extra },
  });

  function nadaGravado(prisma: any, mail: any) {
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.apartamentos_Users.create).not.toHaveBeenCalled();
    expect(prisma.moradores.create).not.toHaveBeenCalled();
    expect(mail.sendWelcomeMorador).not.toHaveBeenCalled();
  }

  it.each(['porteiro@x.com', 'Porteiro@X.com'])('conta nova com e-mail %p = login de portaria → 400, nada gravado', async (email) => {
    const { svc, prisma, mail } = montar();
    await expect(svc.saveMorador(corpo(email), false, sindico)).rejects.toThrow(MSG);
    nadaGravado(prisma, mail);
  });

  it('conta existente SEM login (achada pelo CPF) com e-mail = login de portaria → 400, nada gravado', async () => {
    const { svc, prisma, mail } = montar({ id: 80, cpf: '52998224725', email: null, login: null, password: null, name: 'X' });
    await expect(
      svc.saveMorador(corpo('porteiro@x.com', { documento: '52998224725' }), false, sindico),
    ).rejects.toThrow(MSG);
    nadaGravado(prisma, mail);
  });

  it('controle: a conta achada já é a do porteiro (login igual) → ligada ao apto, login não regravado', async () => {
    const { svc, prisma } = montar({
      id: 81, cpf: null, email: 'porteiro@x.com', login: 'porteiro@x.com', password: 'hash', name: 'Porteiro', phone: '1',
    });
    await svc.saveMorador(corpo('porteiro@x.com'), false, sindico);
    expect(prisma.apartamentos_Users.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_apto: 11, id_user: 81 }) });
    expect(prisma.moradores.create).toHaveBeenCalled();
    for (const [arg] of prisma.users.update.mock.calls) expect(arg.data.login).toBeUndefined();
  });

  it('controle: e-mail livre → conta nova criada com o login', async () => {
    const { svc, prisma } = montar();
    await svc.saveMorador(corpo('livre@x.com'), false, sindico);
    expect(prisma.users.create.mock.calls[0][0].data).toMatchObject({ email: 'livre@x.com', login: 'livre@x.com' });
  });
});
