import { UnauthorizedException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';

/**
 * Login do app é rota pública sem DTO: o corpo chega cru. Objeto em `login`
 * virava filtro do Prisma (`{"startsWith":"a"}` enumera contas pelo tempo de
 * resposta) e no funcionário o `trim()` num objeto derrubava a rota com 500.
 * Login e senha só como string — fora disso, a mesma resposta de credencial
 * inválida, sem consultar o banco (como o `loginSindico`).
 */
describe('Login do app — login e senha só como string', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      users: { findFirst: jest.fn(async () => null) },
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
    };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 'tok') } as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  const invalidos: [string, any, any][] = [
    ['login objeto (filtro do Prisma)', { startsWith: 'a' }, 'qualquer'],
    ['login array', ['a@x.com'], 'qualquer'],
    ['login número', 123, 'qualquer'],
    ['login vazio', '   ', 'qualquer'],
    ['senha objeto', 'a@x.com', { startsWith: '$2' }],
    ['senha ausente', 'a@x.com', undefined],
  ];

  describe.each([
    ['loginMorador', (svc: MobileAuthService, l: any, s: any) => svc.loginMorador(l, s)],
    ['loginFuncionario', (svc: MobileAuthService, l: any, s: any) => svc.loginFuncionario(l, s)],
  ])('%s', (_nome, chamar) => {
    it.each(invalidos)('%s -> credencial inválida, sem consultar o banco', async (_caso, login, senha) => {
      const { svc, prisma } = build();
      const erro: any = await chamar(svc, login, senha).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(erro.message).toBe('Login ou Senha incorretos');
      expect(prisma.users.findFirst).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
    });
  });
});
