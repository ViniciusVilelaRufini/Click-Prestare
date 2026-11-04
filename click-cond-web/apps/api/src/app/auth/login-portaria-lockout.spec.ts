import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Pentest 04/11. O lockout do login da portaria era indexado pela string crua do login, mas o MySQL
 * compara `login` sem diferenciar caixa nem espaços à direita: "joao", "JOAO" e "joao " são a mesma
 * conta. Alternando a grafia, cada tentativa caía num contador novo e a trava nunca disparava.
 * E o corpo é tipo inline (o ValidationPipe não barra objeto): `{"login": {"not": ""}}` virava filtro
 * do Prisma.
 */
describe('AuthService.loginPortaria — lockout e tipo do login', () => {
  function build() {
    const prisma: any = {
      isConnected: true,
      // Nenhuma conta: toda tentativa falha e conta para o lockout.
      funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
      users: { findFirst: jest.fn(async () => null) },
    };
    const jwt: any = { sign: jest.fn(() => 'token') };
    const svc = new AuthService(prisma, jwt, {} as any);
    return { svc, prisma };
  }

  it('variações de caixa e espaços do mesmo login somam no MESMO contador', async () => {
    const { svc, prisma } = build();
    const grafias = ['joao', 'JOAO', 'Joao', 'joao ', ' jOaO', 'JoAo', 'joaO', 'JOao'];
    for (const g of grafias) {
      await expect(svc.loginPortaria(g, 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
    }
    prisma.funcionarios_Portaria.findFirst.mockClear();

    await expect(svc.loginPortaria('jOAO', 'errada')).rejects.toThrow(/Muitas tentativas/);
    // Travado antes de consultar o banco.
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
  });

  it('login ou senha que não são string são recusados sem chegar ao Prisma', async () => {
    const { svc, prisma } = build();
    await expect(svc.loginPortaria({ not: '' } as any, 'x')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.loginPortaria('joao', { a: 1 } as any)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });
});
