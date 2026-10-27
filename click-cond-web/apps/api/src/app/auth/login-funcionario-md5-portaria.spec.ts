import { createHash } from 'crypto';
import { MobileAuthService } from './mobile-auth.service';

/**
 * verifyPassword migrava hash MD5 para bcrypt sempre em Users, com o id que
 * recebia. O loginFuncionario passava Funcionarios_Portaria.id — outra tabela,
 * outra numeração: o login do porteiro trocava a senha do Users de mesmo
 * número (outra pessoa), e a linha da portaria ficava em MD5 para sempre.
 */
describe('loginFuncionario — senha MD5 legada da portaria', () => {
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const portaria = { id: 5, login: 'p', email: null, telefone: null, turno: null, password: md5('x'), id_condominio: 1, nome: 'P' };

  function build(usuarioExistente: any) {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => usuarioExistente),
        create: jest.fn(async () => ({ id: 40, photo: null, password: 'h', funcionarios: [] })),
        update: jest.fn(async () => ({})),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async () => ({ ...portaria })),
        update: jest.fn(async () => ({})),
      },
      funcionarios: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        count: jest.fn(async () => 0),
      },
      sindicos: { count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      moradores: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
    };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('sem conta Users: migra a linha da portaria (id 5), não o Users id 5', async () => {
    const { svc, prisma } = build(null);
    await svc.loginFuncionario('p', 'x');

    expect(prisma.users.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { password: expect.stringMatching(/^\$2/) },
    });
  });

  it('fallback da conta de equipe: migra a portaria e só grava no Users da própria conta (id 60)', async () => {
    const { svc, prisma } = build({
      id: 60, login: 'p', email: 'p', password: md5('outra'), photo: null,
      funcionarios: [{ id_condominio: 1, nome: 'P' }],
    });
    await svc.loginFuncionario('p', 'x');

    expect(prisma.users.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
    expect(prisma.funcionarios_Portaria.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { password: expect.stringMatching(/^\$2/) },
    });
    expect(prisma.users.update).toHaveBeenCalledWith({ where: { id: 60 }, data: { password: expect.stringMatching(/^\$2/) } });
  });
});
