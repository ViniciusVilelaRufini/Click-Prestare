import { BadRequestException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * Users.login e Funcionarios_Portaria.login são ligados só por texto. O /sindico/signup (público, sem
 * verificação de e-mail) criava Users com o login de um porteiro já cadastrado: o loginFuncionario passava a
 * tratar a conta nova como a dele. A recusa usa a mesma mensagem neutra do e-mail indisponível.
 */
const MSG_SIGNUP = 'Não foi possível concluir o cadastro com esses dados. Se você já tem conta, entre ou recupere a senha.';

describe('signupSindico — e-mail igual a um login de portaria', () => {
  function montar(portarias: Array<{ login: string; email: string | null }>) {
    const prisma: any = {
      isConnected: true,
      users: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 77, photo: null })),
        update: jest.fn(async () => ({})),
      },
      sindicos: { create: jest.fn(async () => ({ id: 5, name: 'Ana' })) },
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) =>
          portarias.find((p) => (where.OR ?? []).some((c: any) => c.login === p.login || (c.email && c.email === p.email))) ?? null,
        ),
      },
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 'tok') } as any, {} as any, storage, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }
  const base = { nome: 'Ana', email: '  Porteiro@X.com ', password: 'Senha@123' };

  it('e-mail (normalizado) = login de portaria → 400 neutro e nada é criado', async () => {
    const { svc, prisma } = montar([{ login: 'porteiro@x.com', email: null }]);
    const r = svc.signupSindico(base);
    await expect(r).rejects.toBeInstanceOf(BadRequestException);
    await expect(r).rejects.toThrow(MSG_SIGNUP);
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.sindicos.create).not.toHaveBeenCalled();
  });

  it('e-mail livre na portaria continua criando a conta', async () => {
    const { svc, prisma } = montar([{ login: 'outro@x.com', email: 'outro@x.com' }]);
    await expect(svc.signupSindico(base)).resolves.toMatchObject({ token: 'tok' });
    expect(prisma.users.create).toHaveBeenCalled();
  });
});
