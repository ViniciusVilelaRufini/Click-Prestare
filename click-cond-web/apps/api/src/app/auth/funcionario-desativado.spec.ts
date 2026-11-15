import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TenantAccessService } from './tenant-access.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { MobileAuthService } from './mobile-auth.service';
import { MSG_FUNCIONARIO_DESATIVADO, loginPortariaDesativadoNoCondominio } from './login-portaria-desativado.util';

/**
 * Rodada 4 (raia e), correção C1 — desativar um porteiro na aba "Equipe da portaria" (Funcionarios_Portaria.ativo
 * = 0) corta TODO o acesso dele a ESTE condomínio enquanto estiver inativo: console por senha, console por QR,
 * sessão de QR aberta (JwtStrategy, até 30 s) e o app como funcionário. O vínculo Funcionarios não tem "ativo":
 * quem decide é loginPortariaDesativadoNoCondominio. Síndico, morador e outro condomínio não são afetados.
 */
describe('Login de portaria desativado — corta o funcionário deste condomínio', () => {
  type Linha = Record<string, any>;
  const SENHA = 'Senha#123';
  const hash = bcrypt.hashSync(SENHA, 4);

  function banco() {
    const db = {
      users: [
        { id: 5, login: 'ana@x.com', email: 'ana@x.com', password: hash, photo: null, senha_alterada_em: null },
        { id: 8, login: 'mix@x.com', email: 'mix@x.com', password: hash, photo: null, senha_alterada_em: null }, // morador + equipe
        { id: 9, login: 'sm@x.com', email: 'sm@x.com', password: hash, photo: null, senha_alterada_em: null }, // síndico + equipe
      ] as Linha[],
      fp: [
        { id: 12, nome: 'Ana', login: 'ana@x.com', email: 'ana@x.com', password: hash, turno: 'Diurno', ativo: 1, id_condominio: 1 },
        { id: 13, nome: 'Mix', login: 'mix@x.com', email: 'mix@x.com', password: hash, turno: 'Diurno', ativo: 1, id_condominio: 1 },
        { id: 14, nome: 'SM', login: 'sm@x.com', email: 'sm@x.com', password: hash, turno: 'Diurno', ativo: 1, id_condominio: 1 },
      ] as Linha[],
      // Ana é da equipe dos condomínios 1 e 2; a linha de portaria dela é do 1.
      func: [
        { id: 70, id_user: 5, id_condominio: 1, nome: 'Ana', ocorrencias: 1, condominio: { id: 1, nome: 'Um', ativo: 1 } },
        { id: 71, id_user: 5, id_condominio: 2, nome: 'Ana', ocorrencias: 1, condominio: { id: 2, nome: 'Dois', ativo: 1 } },
        { id: 72, id_user: 8, id_condominio: 1, nome: 'Mix', ocorrencias: 1, condominio: { ativo: 1 } },
        { id: 73, id_user: 9, id_condominio: 1, nome: 'SM', ocorrencias: 1, condominio: { ativo: 1 } },
      ] as Linha[],
      sindCond: [{ id: 1, id_user: 9, id_condominio: 1 }] as Linha[],
      aptUsers: [{ id_apto: 100, id_user: 8, id_condominio: 1 }] as Linha[],
    };
    const em = (v: any, x: any) => (v && typeof v === 'object' && 'in' in v ? v.in.includes(x) : v === x);
    const casa = (row: Linha, where: Linha = {}): boolean =>
      Object.entries(where).every(([k, v]) => {
        if (k === 'OR') return (v as Linha[]).some((w) => casa(row, w));
        if (k === 'condominio') return true; // todos os condomínios do teste estão ativos
        if (k === 'apartamento') return row.id_condominio === v.id_condominio;
        return em(v, row[k]);
      });
    const tabela = (rows: Linha[]) => ({
      findFirst: jest.fn(async ({ where }: any = {}) => {
        const r = rows.find((x) => casa(x, where));
        return r ? { ...r } : null;
      }),
      findUnique: jest.fn(async ({ where }: any = {}) => {
        const r = rows.find((x) => casa(x, where));
        return r ? { ...r } : null;
      }),
      findMany: jest.fn(async ({ where }: any = {}) => rows.filter((x) => casa(x, where)).map((x) => ({ ...x }))),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((x) => casa(x, where))!, data)),
      create: jest.fn(async ({ data }: any) => ({ id: 999, ...data })),
      count: jest.fn(async () => 0),
    });
    const prisma: any = {
      isConnected: true,
      users: tabela(db.users),
      funcionarios_Portaria: tabela(db.fp),
      funcionarios: tabela(db.func),
      sindicos_Condominios: tabela(db.sindCond),
      apartamentos_Users: tabela(db.aptUsers),
      condominios: { findUnique: jest.fn(async () => ({ nome: 'Edifício Demo' })) },
    };
    // loginFuncionario: a conta vem com os vínculos de equipe (include funcionarios).
    const usersFindFirst = prisma.users.findFirst;
    prisma.users.findFirst = jest.fn(async (args: any) => {
      if (args?.include?.sindicos) return null; // loginPortaria: nenhuma destas contas é o síndico do login
      const u = await usersFindFirst(args);
      if (u && args?.include?.funcionarios) u.funcionarios = db.func.filter((f) => f.id_user === u.id).map((f) => ({ ...f }));
      return u;
    });
    return { db, prisma };
  }

  const desativar = (db: any, login = 'ana@x.com') => (db.fp.find((f: Linha) => f.login === login).ativo = 0);
  const reativar = (db: any, login = 'ana@x.com') => (db.fp.find((f: Linha) => f.login === login).ativo = 1);

  const anaApp = { sub: 5, nome: 'Ana', typeAccess: 'Funcionario', user: { id: 5 } } as any;
  const anaQr = (cond: number) => ({ sub: 5, nome: 'Ana', id_condominio: cond, turno: 'Porteiro (App)', typeAccess: 'Funcionario', iat: 1 }) as any;
  const moradorMix = { sub: 8, nome: 'Mix', typeAccess: 'Morador', user: { id: 8, is_funcionario: 1 } } as any;
  const sindicoSm = { sub: 9, nome: 'SM', typeAccess: 'Sindico', user: { id: 9 } } as any;

  it('o helper: só a linha deste condomínio, todas inativas', async () => {
    const { db, prisma } = banco();
    expect(await loginPortariaDesativadoNoCondominio(prisma, 5, 1)).toBe(false);
    desativar(db);
    expect(await loginPortariaDesativadoNoCondominio(prisma, 5, 1)).toBe(true);
    expect(await loginPortariaDesativadoNoCondominio(prisma, 5, 2)).toBe(false); // sem linha de portaria no 2
    prisma.funcionarios_Portaria.findMany.mockRejectedValueOnce(new Error('banco instável'));
    expect(await loginPortariaDesativadoNoCondominio(prisma, 5, 1)).toBe(false); // fail-open, como o JwtStrategy
  });

  describe('app como funcionário (TenantAccessService)', () => {
    it('desativado: recusado neste condomínio, segue no outro; reativado volta', async () => {
      const { db, prisma } = banco();
      const tenant = new TenantAccessService(prisma);
      desativar(db);
      await expect(tenant.assertCondominio(1, anaApp)).rejects.toThrow(new ForbiddenException(MSG_FUNCIONARIO_DESATIVADO));
      await expect(tenant.assertPermissaoFuncionario(1, 'ocorrencias', anaApp)).rejects.toThrow(MSG_FUNCIONARIO_DESATIVADO);
      await expect(tenant.assertCondominio(2, anaApp)).resolves.toBeUndefined();
      await expect(tenant.assertPermissaoFuncionario(2, 'ocorrencias', anaApp)).resolves.toBeUndefined();
      reativar(db);
      await expect(tenant.assertCondominio(1, anaApp)).resolves.toBeUndefined();
      await expect(tenant.assertPermissaoFuncionario(1, 'ocorrencias', anaApp)).resolves.toBeUndefined();
    });

    it('morador e síndico com linha de portaria desativada aqui não são afetados', async () => {
      const { db, prisma } = banco();
      const tenant = new TenantAccessService(prisma);
      desativar(db, 'mix@x.com');
      desativar(db, 'sm@x.com');
      await expect(tenant.assertCondominio(1, moradorMix)).resolves.toBeUndefined();
      await expect(tenant.assertCondominio(1, sindicoSm)).resolves.toBeUndefined();
    });
  });

  describe('console', () => {
    it('por senha: a linha desativada não entra', async () => {
      const { db, prisma } = banco();
      desativar(db);
      const svc = new AuthService(prisma, { sign: jest.fn(() => 't') } as any, { get: jest.fn(), confirm: jest.fn() } as any);
      await expect(svc.loginPortaria('ana@x.com', SENHA)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.funcionarios_Portaria.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ ativo: 1 }) });
    });

    it('por QR: desativado é recusado com mensagem clara; outro condomínio e reativado passam; síndico não é afetado', async () => {
      const { db, prisma } = banco();
      const qrStore: any = { get: jest.fn(async () => ({ status: 'pending' })), confirm: jest.fn(async () => true) };
      const svc = new AuthService(prisma, { sign: jest.fn(() => 't') } as any, qrStore);
      desativar(db);
      desativar(db, 'sm@x.com');
      await expect(svc.authorizeQrSession(anaApp, 'qr', 1)).rejects.toThrow(new UnauthorizedException(MSG_FUNCIONARIO_DESATIVADO));
      await expect(svc.authorizeQrSession(anaApp, 'qr', 2)).resolves.toEqual({ success: true });
      await expect(svc.authorizeQrSession(sindicoSm, 'qr', 1)).resolves.toEqual({ success: true });
      reativar(db);
      await expect(svc.authorizeQrSession(anaApp, 'qr', 1)).resolves.toEqual({ success: true });
    });

    it('sessão de QR aberta cai (JwtStrategy); reativado volta; síndico e outro condomínio seguem', async () => {
      const { db, prisma } = banco();
      const nova = () => {
        const s = new JwtStrategy(prisma);
        (s as any).logger = { warn: jest.fn() };
        return s;
      };
      desativar(db);
      desativar(db, 'sm@x.com');
      await expect(nova().validate(anaQr(1))).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(nova().validate(anaQr(2))).resolves.toBeTruthy();
      const sindicoQr = { sub: 9, nome: 'SM', id_condominio: 1, turno: 'Síndico', typeAccess: 'Sindico', iat: 1 } as any;
      await expect(nova().validate(sindicoQr)).resolves.toBeTruthy();
      reativar(db);
      await expect(nova().validate(anaQr(1))).resolves.toBeTruthy();
    });
  });

  describe('login do app (loginFuncionario)', () => {
    const svcDe = (prisma: any) =>
      new MobileAuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any, {} as any, {} as any, {} as any);

    it('com vínculo em outro condomínio: entra, e a sessão é do outro', async () => {
      const { db, prisma } = banco();
      desativar(db);
      const r = await svcDe(prisma).loginFuncionario('ana@x.com', SENHA);
      expect(r.token).toBe('t');
      expect((await svcDe(prisma).listCondominiosFuncionario(5)).map((c: any) => c.id)).toEqual([2]);
      reativar(db);
      expect((await svcDe(prisma).listCondominiosFuncionario(5)).map((c: any) => c.id)).toEqual([1, 2]);
    });

    it('só com vínculo no condomínio desativado: recusado; reativado volta', async () => {
      const { db, prisma } = banco();
      db.func.splice(db.func.findIndex((f) => f.id === 71), 1);
      desativar(db);
      await expect(svcDe(prisma).loginFuncionario('ana@x.com', SENHA)).rejects.toThrow(new UnauthorizedException(MSG_FUNCIONARIO_DESATIVADO));
      reativar(db);
      await expect(svcDe(prisma).loginFuncionario('ana@x.com', SENHA)).resolves.toEqual(expect.objectContaining({ token: 't' }));
    });

    it('fallback: linha de portaria desativada não recria conta nem vínculo', async () => {
      const { db, prisma } = banco();
      db.users.splice(0, 1); // a Ana ainda não tem conta no app
      desativar(db);
      await expect(svcDe(prisma).loginFuncionario('ana@x.com', SENHA)).rejects.toThrow('Login ou Senha incorretos');
      expect(prisma.users.create).not.toHaveBeenCalled();
      expect(prisma.funcionarios.create).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ativo: 1 }) }));
    });
  });
});
