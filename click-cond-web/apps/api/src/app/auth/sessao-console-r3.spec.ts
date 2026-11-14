import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload.interface';

/**
 * Rodada 3 (raia s) — sessão do console:
 * M11 — senha atual errada em "Alterar senha" respondia 401; o interceptor do console trata todo 401 como fim de
 *       sessão: deslogava o síndico e apagava o aparelho confiável.
 * M12 — síndico com linha própria em Funcionarios_Portaria (mesmo login): o login conferia primeiro essa senha e
 *       emitia sessão de SÍNDICO; trocar ou redefinir a senha do síndico (Users) deixava a antiga entrando.
 * M13 — a lista de condomínios do síndico que entrava por esse caminho trazia condomínio desativado, e escolher um
 *       condomínio que não administra (ou sem ser síndico) dava 401, que desloga.
 * B1 — "síndico sem condomínio ativo" saía antes de conferir a senha (revelava a conta a quem não sabe a senha).
 */
describe('AuthService — sessão do console (rodada 3)', () => {
  let hashUsers: string;
  let hashPortaria: string;
  beforeAll(async () => {
    hashUsers = await bcrypt.hash('senha-do-sindico', 4);
    hashPortaria = await bcrypt.hash('senha-antiga-da-portaria', 4);
  });

  describe('M11 — senha atual incorreta não é fim de sessão', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        users: { findUnique: jest.fn(async () => ({ id: 42, password: hashUsers })), update: jest.fn() },
        funcionarios_Portaria: { findUnique: jest.fn(async () => ({ id: 3, password: hashPortaria })), update: jest.fn() },
      };
      return { svc: new AuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any), prisma };
    }

    it('síndico: 400 "Senha atual incorreta." e nada é gravado', async () => {
      const { svc, prisma } = build();
      const sessao: JwtPayload = { sub: 42, nome: 'S', id_condominio: 7, typeAccess: 'Sindico' };
      const p = svc.changePassword(42, 'errada', 'nova-senha', 'Sindico', sessao);
      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow('Senha atual incorreta.');
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('porteiro: 400 "Senha atual incorreta." e nada é gravado', async () => {
      const { svc, prisma } = build();
      const sessao: JwtPayload = { sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' };
      const p = svc.changePassword(3, 'errada', 'nova-senha', undefined, sessao);
      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow('Senha atual incorreta.');
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    });
  });

  describe('M12/M13/B1 — login por senha', () => {
    function build(opts: { ativos?: number[]; comPortaria?: boolean; sindicoEm?: number[] } = {}) {
      const sindicoEm = opts.sindicoEm ?? [7, 8];
      const ativos = new Set(opts.ativos ?? [7, 8]);
      const assinados: JwtPayload[] = [];
      const vinculos = sindicoEm.map((id, i) => ({ id: i + 1, id_user: 42, id_condominio: id, condominio: { nome: `C${id}` } }));
      const prisma: any = {
        isConnected: true,
        funcionarios_Portaria: {
          // O login de portaria do síndico, no condomínio 7 (o findFirst do login já exige condomínio ativo).
          findFirst: jest.fn(async () =>
            opts.comPortaria === false
              ? null
              : { id: 3, nome: 'Registro', login: 'sindico@demo.com', email: 'sindico@demo.com', password: hashPortaria, turno: 'Síndico', id_condominio: 7, ativo: 1 },
          ),
          update: jest.fn(),
        },
        condominios: { findUnique: jest.fn(async () => ({ nome: 'C7' })) },
        users: {
          // Respeita os filtros do include de sindicosCondominios (por condomínio e por condomínio ativo).
          findFirst: jest.fn(async (args: any) => {
            const w = args?.include?.sindicosCondominios?.where ?? {};
            const lista = vinculos.filter(
              (v) =>
                (w.id_condominio === undefined || v.id_condominio === w.id_condominio) &&
                (w.condominio?.ativo !== 1 || ativos.has(v.id_condominio)),
            );
            return {
              id: 42,
              login: 'sindico@demo.com',
              email: 'sindico@demo.com',
              password: hashUsers,
              sindicos: [{ name: 'Sindica' }],
              sindicosCondominios: lista,
            };
          }),
          update: jest.fn(),
        },
      };
      const jwt: any = { sign: jest.fn((p: JwtPayload) => { assinados.push(p); return 'tok'; }) };
      const svc = new AuthService(prisma, jwt, { get: jest.fn(), confirm: jest.fn() } as any);
      // Lockout fora do caminho (estado compartilhado sem banco).
      (svc as any).isLocked = jest.fn(async () => false);
      (svc as any).registrarFalha = jest.fn(async () => undefined);
      (svc as any).limparFalhas = jest.fn(async () => undefined);
      return { svc, prisma, assinados };
    }

    it('M12: a senha antiga do login de portaria do síndico não entra mais (só a senha da conta)', async () => {
      const { svc, assinados } = build();
      await expect(svc.loginPortaria('sindico@demo.com', 'senha-antiga-da-portaria')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(assinados).toHaveLength(0);
    });

    it('M12: com a senha da conta (Users), o síndico entra como síndico', async () => {
      const { svc, assinados } = build();
      await svc.loginPortaria('sindico@demo.com', 'senha-do-sindico');
      expect(assinados).toEqual([expect.objectContaining({ sub: 42, typeAccess: 'Sindico' })]);
    });

    it('M13: a lista de condomínios do síndico não traz condomínio desativado', async () => {
      const { svc } = build({ ativos: [7] });
      const res: any = await svc.loginPortaria('sindico@demo.com', 'senha-do-sindico');
      expect(res.condominios).toEqual([{ id: 7, nome: 'C7' }]);
    });

    it('B1: "sem condomínio ativo" só aparece para quem sabe a senha', async () => {
      const { svc } = build({ ativos: [], comPortaria: false });
      await expect(svc.loginPortaria('sindico@demo.com', 'chute')).rejects.toThrow('Credenciais inválidas.');
      await expect(svc.loginPortaria('sindico@demo.com', 'senha-do-sindico')).rejects.toThrow('Síndico sem condomínio ativo vinculado.');
    });
  });

  describe('M13 — trocar de condomínio sem vínculo é 403 (não desloga)', () => {
    function build() {
      const prisma: any = {
        isConnected: true,
        sindicos_Condominios: { findFirst: jest.fn(async () => null) },
        funcionarios_Portaria: { findFirst: jest.fn(async () => null) },
        users: { findFirst: jest.fn(async () => null) },
      };
      return new AuthService(prisma, { sign: jest.fn(() => 't'), decode: jest.fn(() => ({})) } as any, {} as any);
    }

    it('condomínio que não administra (ou desativado) → 403', async () => {
      const svc = build();
      const sindico: JwtPayload = { sub: 42, nome: 'S', id_condominio: 7, typeAccess: 'Sindico' };
      await expect(svc.selecionarCondominio(sindico, 99)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sessão que não é de síndico → 403', async () => {
      const svc = build();
      const porteiro: JwtPayload = { sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' };
      await expect(svc.selecionarCondominio(porteiro, 8)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
