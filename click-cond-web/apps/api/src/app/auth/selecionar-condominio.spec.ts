import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * POST /auth/selecionar-condominio é uma segunda porta de emissão de token:
 *  - escolhia o ramo do porteiro (sub = Funcionarios_Portaria.id) pela FORMA
 *    do token, que outros emissores também produzem com sub = Users.id;
 *  - não recusava condomínio desativado no CRM (o loginPortaria recusa);
 *  - apagava o `exp` e dava 24h novas a cada chamada: a sessão nunca vencia.
 */
describe('AuthService.selecionarCondominio', () => {
  const agora = () => Math.floor(Date.now() / 1000);

  function build(opts: { ativos?: Record<number, boolean> } = {}) {
    const ativos = opts.ativos ?? { 7: true, 8: true };
    // Mesmo registro do JwtModule (signOptions 365d), para o merge de opções ser o real.
    const jwt = new JwtService({ secret: 'test', signOptions: { expiresIn: '365d' } });
    const prisma: any = {
      isConnected: true,
      sindicos_Condominios: {
        // O usuário 42 administra 7 e 8.
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.id_user !== 42 || !(where.id_condominio in ativos)) return null;
          if (where.condominio?.ativo === 1 && !ativos[where.id_condominio]) return null;
          return { id: 1, id_condominio: where.id_condominio, condominio: { nome: `C${where.id_condominio}` } };
        }),
      },
      funcionarios_Portaria: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 3 ? { login: 'sindico@demo.com', id_condominio: 7 } : null,
        ),
      },
      users: { findFirst: jest.fn(async () => ({ id: 42, sindicos: [{ id: 1 }] })) },
    };
    const svc = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any);
    return { svc, prisma, jwt };
  }

  const sindico = (exp: number): JwtPayload & { iat: number; exp: number } =>
    ({ sub: 42, nome: 'S', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico', iat: agora() - 10, exp });

  it('NEGA trocar para condomínio desativado', async () => {
    const { svc, prisma } = build({ ativos: { 7: true, 8: false } });
    await expect(svc.selecionarCondominio(sindico(agora() + 3600), 8)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.sindicos_Condominios.findFirst.mock.calls[0][0].where.condominio).toEqual({ ativo: 1 });
  });

  it('não renova: o token novo vence junto com o de origem', async () => {
    const { svc, jwt } = build();
    const exp = agora() + 60;
    const res = await svc.selecionarCondominio(sindico(exp), 7);
    const novo: any = jwt.decode(res.access_token);
    expect(novo.id_condominio).toBe(7);
    expect(novo.exp).toBeLessThanOrEqual(exp);
  });

  it('token de origem longo (app, 365d) continua limitado ao teto da portaria', async () => {
    const { svc, jwt } = build();
    const res = await svc.selecionarCondominio(sindico(agora() + 300 * 86400), 8);
    const novo: any = jwt.decode(res.access_token);
    expect(novo.exp).toBeLessThanOrEqual(agora() + 86400 + 5);
  });

  it('token sem typeAccess e sem tipo_sub NÃO é tratado como porteiro (sub pode ser Users.id)', async () => {
    const { svc, prisma } = build();
    const formaDoQr: any = { sub: 3, nome: 'X', id_condominio: 7, iat: agora(), exp: agora() + 3600 };
    await expect(svc.selecionarCondominio(formaDoQr, 8)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.funcionarios_Portaria.findFirst).not.toHaveBeenCalled();
  });

  it('porteiro do console (tipo_sub carimbado) cujo login é o síndico continua trocando', async () => {
    const { svc, prisma, jwt } = build();
    const porteiro: any = { sub: 3, nome: 'P', id_condominio: 7, turno: 'Geral', tipo_sub: 'funcionario_portaria', iat: agora(), exp: agora() + 3600 };
    const res = await svc.selecionarCondominio(porteiro, 8);
    expect((jwt.decode(res.access_token) as any)).toMatchObject({ id_condominio: 8, tipo_sub: 'funcionario_portaria' });
    expect(prisma.funcionarios_Portaria.findFirst.mock.calls[0][0].where).toEqual({ id: 3, ativo: 1, condominio: { ativo: 1 } });
  });
});
