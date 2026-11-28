import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConferenciaIndisponivelException, JwtStrategy } from '../auth/jwt.strategy';
import { TenantGuard } from '../auth/tenant.guard';
import { TenantAccessService } from '../auth/tenant-access.service';
import { InterfonePortariaController } from '../interfone/interfone-portaria.controller';
import { RealtimeGateway, SALA_CENTRAL } from '../realtime/realtime.gateway';
import { CentralAuthController } from './central-auth.controller';
import { operadorDoToken } from './operador.util';

jest.mock('../realtime/redis-adapter', () => ({ criarAdaptadorRedis: jest.fn() }));

/**
 * Review Focus 3: um token de operador enxerga vários condomínios, então ele só vale nas rotas da
 * central; e o token de porteiro (ou de app) não vale nelas.
 */
const CRED = 'a'.repeat(32);
const operadorToken = (extra: Record<string, unknown> = {}): any => ({
  sub: 7,
  nome: 'Ana Central',
  papel: 'operador_central',
  cred: CRED,
  ...extra,
});
const porteiroToken: any = { sub: 7, nome: 'Porteiro', id_condominio: 1, tipo_sub: 'funcionario_portaria', cred: 'x' };
const moradorToken: any = { sub: 7, nome: 'Morador', typeAccess: 'Morador', user: { id: 7, typeAccess: 'Morador' } };

describe('operadorDoToken', () => {
  it('token de operador → uid e nome', () => {
    expect(operadorDoToken(operadorToken())).toEqual({ uid: 7, nome: 'Ana Central' });
  });

  it('token com trocar_senha → 403 motivo trocar_senha (exceto na rota de troca)', () => {
    const t = operadorToken({ trocar_senha: true });
    let err: any;
    try {
      operadorDoToken(t);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ statusCode: 403, motivo: 'trocar_senha' });
    expect(operadorDoToken(t, { permitirTrocaDeSenha: true })).toEqual({ uid: 7, nome: 'Ana Central' });
  });

  it('token de porteiro → 403', () => {
    expect(() => operadorDoToken(porteiroToken)).toThrow(ForbiddenException);
  });

  it('token de app, sem token ou sub inválido → 403', () => {
    expect(() => operadorDoToken(moradorToken)).toThrow(ForbiddenException);
    expect(() => operadorDoToken(undefined as any)).toThrow(ForbiddenException);
    expect(() => operadorDoToken(operadorToken({ sub: 'abc' }))).toThrow(ForbiddenException);
    expect(() => operadorDoToken(operadorToken({ sub: 0 }))).toThrow(ForbiddenException);
  });

  it('papel de operador misturado com condomínio, tipo_sub, typeAccess ou role → 403', () => {
    expect(() => operadorDoToken(operadorToken({ id_condominio: 1 }))).toThrow(ForbiddenException);
    expect(() => operadorDoToken(operadorToken({ tipo_sub: 'funcionario_portaria' }))).toThrow(ForbiddenException);
    expect(() => operadorDoToken(operadorToken({ typeAccess: 'Sindico' }))).toThrow(ForbiddenException);
    expect(() => operadorDoToken(operadorToken({ role: 'crm_admin' }))).toThrow(ForbiddenException);
  });
});

describe('JwtStrategy.validate — operador da central', () => {
  function build(linha: any = { id: 7, ativo: 1, cred: CRED }) {
    const prisma: any = {
      isConnected: true,
      central_Operadores: {
        findFirst: jest.fn(async ({ where }: any) =>
          linha && where.id === linha.id && (where.ativo === undefined || where.ativo === linha.ativo) ? linha : null,
        ),
      },
    };
    const strategy = new JwtStrategy(prisma);
    (strategy as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    return { strategy, prisma };
  }

  it('operador ativo com o mesmo cred passa e mantém o papel', async () => {
    const { strategy } = build();
    const p = await strategy.validate(operadorToken());
    expect(p.papel).toBe('operador_central');
    expect(p.sub).toBe(7);
  });

  it('validate recusa operador desativado ou com cred trocado', async () => {
    await expect(build({ id: 7, ativo: 0, cred: CRED }).strategy.validate(operadorToken())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(build({ id: 7, ativo: 1, cred: 'b'.repeat(32) }).strategy.validate(operadorToken())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(build(null).strategy.validate(operadorToken())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('consulta só operador ativo (ativo = 1 no where)', async () => {
    const { strategy, prisma } = build();
    await strategy.validate(operadorToken());
    expect(prisma.central_Operadores.findFirst.mock.calls[0][0].where).toMatchObject({ id: 7, ativo: 1 });
  });

  it('token de operador sem cred ou com cred vazio é recusado', async () => {
    const { strategy } = build({ id: 7, ativo: 1, cred: '' });
    await expect(strategy.validate(operadorToken({ cred: undefined }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(operadorToken({ cred: '' }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token com papel de operador e condomínio/tipo_sub é recusado', async () => {
    const { strategy } = build();
    await expect(strategy.validate(operadorToken({ id_condominio: 1 }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(strategy.validate(operadorToken({ tipo_sub: 'funcionario_portaria' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('erro no banco → recusa (fail-closed, ao contrário do porteiro)', async () => {
    const { strategy, prisma } = build();
    prisma.central_Operadores.findFirst.mockRejectedValueOnce(new Error('banco fora'));
    await expect(strategy.validate(operadorToken())).rejects.toBeInstanceOf(UnauthorizedException);
    // A falha não fica em cache: o banco voltou, a sessão volta.
    await expect(strategy.validate(operadorToken())).resolves.toMatchObject({ papel: 'operador_central' });
  });

  it('banco desconectado → recusa (fail-closed)', async () => {
    const { strategy, prisma } = build();
    prisma.isConnected = false;
    await expect(strategy.validate(operadorToken())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(new JwtStrategy().validate(operadorToken())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resultado fica em cache por 30 s', async () => {
    const { strategy, prisma } = build();
    await strategy.validate(operadorToken());
    await strategy.validate(operadorToken());
    expect(prisma.central_Operadores.findFirst).toHaveBeenCalledTimes(1);
  });

  it('"não deu para conferir" (banco com erro ou fora) é um 401 distinto de "revogado" (o socket aberto decide por ele)', async () => {
    const erro = build();
    erro.prisma.central_Operadores.findFirst.mockRejectedValueOnce(new Error('banco fora'));
    const e1 = await erro.strategy.validate(operadorToken()).catch((e) => e);
    expect(e1).toBeInstanceOf(UnauthorizedException);
    expect(e1).toBeInstanceOf(ConferenciaIndisponivelException);

    const fora = build();
    fora.prisma.isConnected = false;
    await expect(fora.strategy.validate(operadorToken())).rejects.toBeInstanceOf(ConferenciaIndisponivelException);
    await expect(new JwtStrategy().validate(operadorToken())).rejects.toBeInstanceOf(ConferenciaIndisponivelException);

    // Revogado de verdade (desativado, cred trocado, sem cred): 401 comum, nunca o "indisponível".
    for (const [linha, token] of [
      [{ id: 7, ativo: 0, cred: CRED }, operadorToken()],
      [{ id: 7, ativo: 1, cred: 'b'.repeat(32) }, operadorToken()],
      [{ id: 7, ativo: 1, cred: CRED }, operadorToken({ cred: undefined })],
    ] as const) {
      const e = await build(linha).strategy.validate(token).catch((x) => x);
      expect(e).toBeInstanceOf(UnauthorizedException);
      expect(e).not.toBeInstanceOf(ConferenciaIndisponivelException);
    }
  });
});

describe('TenantGuard — token de operador só nas rotas da central', () => {
  function ctx(cls: any, handler: string, user: any, params: Record<string, string> = {}) {
    return {
      getType: () => 'http',
      getHandler: () => cls.prototype[handler],
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ user, params, method: 'GET', url: '/api/x' }) }),
    } as any;
  }
  function build() {
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    return { guard: new TenantGuard(new Reflector(), tenant), tenant };
  }

  it('token de operador em GET interfone/portaria/hoje → 403 (guard)', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx(InterfonePortariaController, 'hoje', operadorToken()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('token de operador em rota com :idCondominio → 403 sem consultar vínculo', async () => {
    const { guard, tenant } = build();
    await expect(
      guard.canActivate(ctx(InterfonePortariaController, 'hoje', operadorToken(), { idCondominio: '1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenant.assertCondominio).not.toHaveBeenCalled();
  });

  it('token de operador nas rotas da central passa', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx(CentralAuthController, 'trocarSenha', operadorToken()))).resolves.toBe(true);
  });

  it('rota pública da central (login) passa sem token', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx(CentralAuthController, 'login', undefined))).resolves.toBe(true);
  });

  it('porteiro e morador continuam passando como antes', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctx(InterfonePortariaController, 'hoje', porteiroToken))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(InterfonePortariaController, 'hoje', moradorToken))).resolves.toBe(true);
  });
});

describe('rotas de condomínio com token de operador', () => {
  it('token de operador em GET interfone/portaria/hoje → 403 (controller)', () => {
    const acoes: any = { hoje: jest.fn(async () => []) };
    const c = new InterfonePortariaController(acoes);
    expect(() => c.hoje(operadorToken())).toThrow(ForbiddenException);
    expect(acoes.hoje).not.toHaveBeenCalled();
  });

  it('assertCondominio recusa operador sem ler o sub como Users.id', async () => {
    const prisma: any = {
      isConnected: true,
      apartamentos_Users: { findFirst: jest.fn(async () => ({ id_apto: 1 })) },
      sindicos_Condominios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      funcionarios: { findFirst: jest.fn(async () => ({ id: 1 })) },
    };
    await expect(new TenantAccessService(prisma).assertCondominio(1, operadorToken())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.apartamentos_Users.findFirst).not.toHaveBeenCalled();
  });
});

describe('RealtimeGateway com a JwtStrategy de verdade', () => {
  const jwt = new JwtService({ secret: 'test' });
  const socket = (token: string) =>
    ({ handshake: { auth: { token }, query: {} }, data: {} as any, join: jest.fn(), disconnect: jest.fn() }) as any;

  function build(linha: any) {
    const prisma: any = { isConnected: true, central_Operadores: { findFirst: jest.fn(async () => linha) } };
    const strategy = new JwtStrategy(prisma);
    (strategy as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    const gw = new RealtimeGateway(jwt, { get: jest.fn(() => strategy) } as any);
    (gw as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    return gw;
  }

  it('operador ativo entra na sala central', async () => {
    const gw = build({ id: 7, ativo: 1, cred: CRED });
    const s = socket(jwt.sign(operadorToken()));
    await gw.handleConnection(s);
    expect(s.join).toHaveBeenCalledWith(SALA_CENTRAL);
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('operador com trocar_senha não entra na sala central', async () => {
    const gw = build({ id: 7, ativo: 1, cred: CRED });
    const s = socket(jwt.sign(operadorToken({ trocar_senha: true })));
    await gw.handleConnection(s);
    expect(s.join).not.toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });

  it('sem JwtStrategy resolvida: operador é recusado (fail-closed), porteiro segue como antes', async () => {
    const gw = new RealtimeGateway(jwt, { get: jest.fn(() => { throw new Error('sem provider'); }) } as any);
    (gw as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    const op = socket(jwt.sign(operadorToken()));
    await gw.handleConnection(op);
    expect(op.join).not.toHaveBeenCalled();
    expect(op.disconnect).toHaveBeenCalledWith(true);

    const semRef = new RealtimeGateway(jwt);
    (semRef as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    const op2 = socket(jwt.sign(operadorToken()));
    await semRef.handleConnection(op2);
    expect(op2.disconnect).toHaveBeenCalledWith(true);

    const porteiro = socket(jwt.sign(porteiroToken));
    await gw.handleConnection(porteiro);
    expect(porteiro.join).toHaveBeenCalledWith('condominio:1');
  });

  it('operador desativado é desconectado', async () => {
    const gw = build(null);
    const s = socket(jwt.sign(operadorToken()));
    await gw.handleConnection(s);
    expect(s.join).not.toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });
});
