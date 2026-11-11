import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { MobileAuthService } from './mobile-auth.service';
import { momentoTrocaSenha } from './senha-alterada.util';
import { CrmCondominiosService } from '../crm/crm-condominios.service';
import { MoradoresService } from '../moradores/moradores.service';

/**
 * Tokens do app valem 365 dias e a JwtStrategy só conferia a assinatura.
 * Redefinir ou trocar a senha depois de perder o celular não tirava o acesso
 * de quem já tinha o token.
 */
describe('JwtStrategy — sessão anterior à troca de senha', () => {
  const trocaEm = new Date('2026-10-26T12:00:00Z');
  const seg = (d: Date) => Math.floor(d.getTime() / 1000);
  const validar = (s: JwtStrategy, p: any) => Promise.resolve().then(() => s.validate(p));

  function build(senhaAlteradaEm: Date | null) {
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ senha_alterada_em: senhaAlteradaEm })) },
    };
    return { strategy: new JwtStrategy(prisma), prisma };
  }

  it('recusa token de app emitido antes da troca', async () => {
    const { strategy } = build(trocaEm);
    await expect(
      validar(strategy, { sub: 1, nome: 'M', typeAccess: 'Morador', iat: seg(trocaEm) - 60 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa também o token de síndico do console (typeAccess Sindico, sub = Users.id)', async () => {
    const { strategy } = build(trocaEm);
    await expect(
      validar(strategy, { sub: 1, nome: 'S', typeAccess: 'Sindico', id_condominio: 7, iat: seg(trocaEm) - 1 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('aceita token emitido no mesmo segundo da troca ou depois', async () => {
    const { strategy } = build(trocaEm);
    await expect(validar(strategy, { sub: 1, nome: 'M', typeAccess: 'Morador', iat: seg(trocaEm) })).resolves.toBeTruthy();
  });

  it('aceita quando a conta nunca trocou a senha', async () => {
    const { strategy } = build(null);
    await expect(validar(strategy, { sub: 1, nome: 'M', typeAccess: 'Morador', iat: 1 })).resolves.toBeTruthy();
  });

  it('falha na consulta fica em cache: dois validates na janela consultam o banco uma vez só (segue aceitando)', async () => {
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => { throw new Error("Unknown column 'senha_alterada_em'"); }) },
    };
    const strategy = new JwtStrategy(prisma);
    (strategy as any).logger = { warn: jest.fn() };
    const p = { sub: 1, nome: 'M', typeAccess: 'Morador', iat: 1 };

    await expect(validar(strategy, p)).resolves.toBeTruthy();
    await expect(validar(strategy, p)).resolves.toBeTruthy();
    expect(prisma.users.findUnique).toHaveBeenCalledTimes(1);
  });

  it('token do porteiro do console (sub = Funcionarios_Portaria.id) não consulta Users', async () => {
    const { strategy, prisma } = build(trocaEm);
    await expect(validar(strategy, { sub: 1, nome: 'P', id_condominio: 2, iat: 1 })).resolves.toBeTruthy();
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });
});

describe('troca de senha grava senha_alterada_em', () => {
  it('momentoTrocaSenha trunca no segundo (DATETIME(0) arredondaria para cima)', () => {
    expect(momentoTrocaSenha(1_700_000_000_999).getTime()).toBe(1_700_000_000_000);
  });

  it('app: updatePassword grava o momento junto com o hash', async () => {
    const hash = await bcrypt.hash('atual', 4);
    const prisma: any = {
      isConnected: true,
      users: {
        findUnique: jest.fn(async () => ({ id: 9, password: hash })),
        update: jest.fn(async () => ({
          id: 9, login: 'm@t', photo: null, sindicos: [], moradores: [{ nome: 'M' }], funcionarios: [], sindicosCondominios: [],
        })),
      },
    };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any, {} as any, {} as any, {} as any);
    await svc.updatePassword(9, 'nova-senha', 'Morador', 'atual');

    expect(prisma.users.update.mock.calls[0][0].data.senha_alterada_em).toBeInstanceOf(Date);
  });

  it('console: changePassword do síndico grava o momento e devolve token novo com o mesmo escopo', async () => {
    const hash = await bcrypt.hash('atual', 4);
    const prisma: any = {
      isConnected: true,
      users: { findUnique: jest.fn(async () => ({ id: 42, password: hash })), update: jest.fn(async () => ({})) },
    };
    const jwt: any = { sign: jest.fn(() => 'token-novo') };
    const svc = new AuthService(prisma, jwt, {} as any);
    const sessao: any = { sub: 42, nome: 'S', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico', iat: 1, exp: 2 };

    const res: any = await svc.changePassword(42, 'atual', 'nova-senha', 'Sindico', sessao);

    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { password: expect.stringMatching(/^\$2/), senha_alterada_em: expect.any(Date) },
    });
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 42, nome: 'S', id_condominio: 7, turno: 'Síndico', typeAccess: 'Sindico' },
      expect.anything(),
    );
    expect(res.access_token).toBe('token-novo');
  });
});

describe('outras redefinições de senha de Users também gravam senha_alterada_em', () => {
  it('CRM: redefinirSenhaSindico', async () => {
    const prisma: any = {
      sindicos_Condominios: {
        findFirst: jest.fn(async () => ({ user: { id: 42, name: 'S', email: 's@t', login: 's@t' } })),
      },
      users: { update: jest.fn(async () => ({})) },
    };
    const svc = new CrmCondominiosService(prisma, { registrar: jest.fn(async () => ({})) } as any, {} as any);
    await svc.redefinirSenhaSindico(7, 'nova-senha', 'crm');

    expect(prisma.users.update.mock.calls[0][0].data.senha_alterada_em).toBeInstanceOf(Date);
  });

  it('console: sendCredentials (nova senha inicial do morador) derruba os tokens antigos', async () => {
    const prisma: any = {
      isConnected: true,
      moradores: {
        findUnique: jest.fn(async () => ({
          id: 10, nome: 'M', documento: '1', email: 'm@t', telefone: '1', id_condominio: 1, id_user: 99,
          user: { photo: null, apartamentosUsers: [{ id_apto: 1 }] },
        })),
        update: jest.fn(async () => ({})),
        count: jest.fn(async () => 0),
      },
      users: { findFirst: jest.fn(), findUnique: jest.fn(async () => ({ email: 'm@t', login: 'm@t' })), create: jest.fn(), update: jest.fn(async () => ({})) },
      apartamentos: { findUnique: jest.fn(async () => ({ id: 1, bloco: 'A', apto: '106' })) },
      apartamentos_Users: { create: jest.fn(async () => ({})), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      facial_Devices: { findMany: jest.fn(async () => []) },
    };
    const svc = new MoradoresService(
      prisma,
      { sendWelcomeMorador: jest.fn(async () => ({})), sendWelcomeMoradorExisting: jest.fn(async () => ({})) } as any,
      { isDataUrl: jest.fn(() => false), uploadDataUrl: jest.fn(async () => null) } as any,
      { syncMorador: jest.fn(async () => ({})) } as any,
      { registrar: jest.fn(async () => ({})) } as any,
      { enviarMorador: jest.fn(async () => ({ enviado: false })) } as any,
    );
    await svc.sendCredentials(10);

    expect(prisma.users.update.mock.calls[0][0].data.senha_alterada_em).toBeInstanceOf(Date);
  });
});
