import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

/**
 * O token do console do porteiro (sub = Funcionarios_Portaria.id) vale 24h e a JwtStrategy só
 * conferia a assinatura. O síndico removia ou desativava o porteiro e ele seguia lendo o condomínio
 * e acionando o relé da porta (POST facial/devices/:id/trigger) com o token que já tinha.
 */
describe('JwtStrategy — porteiro removido ou desativado', () => {
  const validar = (s: JwtStrategy, p: any) => Promise.resolve().then(() => s.validate(p));
  const porteiro = { sub: 3, nome: 'P', id_condominio: 7, turno: 'Diurno', tipo_sub: 'funcionario_portaria', iat: 1 };

  function build(registro: any) {
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: { findFirst: jest.fn(async () => registro) },
      users: { findUnique: jest.fn(async () => ({ senha_alterada_em: null })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    const strategy = new JwtStrategy(prisma);
    (strategy as any).logger = { warn: jest.fn() };
    return { strategy, prisma };
  }

  it('recusa quando o porteiro não está mais ativo na equipe do condomínio do token', async () => {
    const { strategy, prisma } = build(null);

    await expect(validar(strategy, porteiro)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.funcionarios_Portaria.findFirst).toHaveBeenCalledWith({
      where: { id: 3, id_condominio: 7, ativo: 1, condominio: { ativo: 1 } },
      select: { id: true, login: true, password: true },
    });
  });

  it('aceita o porteiro ativo e não consulta Users (sub não é Users.id)', async () => {
    const { strategy, prisma } = build({ id: 3 });

    await expect(validar(strategy, porteiro)).resolves.toBe(porteiro);
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });

  it('resultado fica em cache: dois validates na janela consultam o banco uma vez só', async () => {
    const { strategy, prisma } = build({ id: 3 });

    await validar(strategy, porteiro);
    await validar(strategy, porteiro);
    expect(prisma.funcionarios_Portaria.findFirst).toHaveBeenCalledTimes(1);
  });

  it('erro na consulta segue aceitando (fail-open) e também fica em cache', async () => {
    const { strategy, prisma } = build(null);
    prisma.funcionarios_Portaria.findFirst.mockImplementation(async () => {
      throw new Error('Connection lost');
    });

    await expect(validar(strategy, porteiro)).resolves.toBe(porteiro);
    await expect(validar(strategy, porteiro)).resolves.toBe(porteiro);
    expect(prisma.funcionarios_Portaria.findFirst).toHaveBeenCalledTimes(1);
  });

  it('token sem tipo_sub (síndico, QR, legado) não consulta Funcionarios_Portaria; o de síndico confere o vínculo', async () => {
    const { strategy, prisma } = build(null);

    await expect(
      validar(strategy, { sub: 42, nome: 'S', id_condominio: 7, typeAccess: 'Sindico', iat: 1 }),
    ).resolves.toBeTruthy();
    await expect(validar(strategy, { sub: 3, nome: 'P', id_condominio: 7, iat: 1 })).resolves.toBeTruthy();
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
    expect(prisma.sindicos_Condominios.findFirst).toHaveBeenCalledTimes(1);
  });
});
