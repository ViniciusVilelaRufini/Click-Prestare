import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { QrSessionStore } from './qr-session.store';
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

  describe('B5 — QR Code de síndico traz a lista de condomínios', () => {
    function build() {
      const store = new QrSessionStore();
      const prisma: any = {
        isConnected: true,
        condominios: { findUnique: jest.fn(async () => ({ nome: 'C7' })) },
        sindicos_Condominios: {
          findFirst: jest.fn(async () => ({ id: 1 })),
          findMany: jest.fn(async ({ where }: any) =>
            where.id_user === 42 && where.condominio?.ativo === 1
              ? [
                  { id_condominio: 7, condominio: { nome: 'C7' } },
                  { id_condominio: 8, condominio: { nome: 'C8' } },
                ]
              : [],
          ),
        },
        funcionarios: { findFirst: jest.fn(async () => ({ id: 1 })) },
      };
      return new AuthService(prisma, { sign: jest.fn(() => 'tok') } as any, store);
    }

    it('síndico: condomínios ativos que administra; funcionário: lista vazia', async () => {
      const svc = build();
      const s1 = await svc.createQrSession();
      await svc.authorizeQrSession({ sub: 42, nome: 'S', typeAccess: 'Sindico' }, s1.qrToken, 7);
      expect(await svc.getQrStatus(s1.qrToken)).toMatchObject({
        status: 'confirmed',
        turno: 'Síndico',
        id_condominio: 7,
        condominios: [{ id: 7, nome: 'C7' }, { id: 8, nome: 'C8' }],
      });

      const s2 = await svc.createQrSession();
      await svc.authorizeQrSession({ sub: 9, nome: 'F', typeAccess: 'Funcionario' }, s2.qrToken, 7);
      expect(await svc.getQrStatus(s2.qrToken)).toMatchObject({ status: 'confirmed', turno: 'Porteiro (App)', condominios: [] });
    });
  });

  describe('Correção 1, I2 — a troca de senha do porteiro no console vale também para o app', () => {
    const sessao: JwtPayload = { sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' };

    function build(conta: Record<string, any> | null, extra: { moradores?: number; equipeFora?: number } = {}) {
      const contas = conta ? [{ ...conta }] : [];
      const prisma: any = {
        isConnected: true,
        funcionarios_Portaria: {
          findUnique: jest.fn(async () => ({ id: 3, login: 'p@x.com', password: hashPortaria, id_condominio: 7 })),
          update: jest.fn(async () => ({})),
        },
        users: {
          // Só acha a conta que tem vínculo de equipe neste condomínio (o filtro `funcionarios.some`).
          findFirst: jest.fn(async ({ where }: any) =>
            contas.find((c) => where.funcionarios?.some?.id_condominio === 7 ? c.equipeAqui : true) ?? null,
          ),
          update: jest.fn(async ({ data }: any) => Object.assign(contas[0], data)),
        },
        sindicos: { count: jest.fn(async () => 0) },
        sindicos_Condominios: { count: jest.fn(async () => 0) },
        moradores: { count: jest.fn(async () => extra.moradores ?? 0) },
        apartamentos_Users: { count: jest.fn(async () => 0) },
        funcionarios: { count: jest.fn(async () => extra.equipeFora ?? 0) },
      };
      prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
      const svc = new AuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any);
      return { svc, prisma, contas };
    }

    it('conta só desta equipe: a senha do app vira a nova e os tokens dela caem', async () => {
      const { svc, contas } = build({ id: 5, login: 'p@x.com', password: '$2b$04$antiga', is_sindico: 0, is_morador: 0, equipeAqui: true });
      await svc.changePassword(3, 'senha-antiga-da-portaria', 'Nova#123', undefined, sessao);
      expect(await bcrypt.compare('Nova#123', contas[0].password)).toBe(true);
      expect(contas[0].senha_alterada_em).toBeInstanceOf(Date);
    });

    it('conta compartilhada (também morador): só os tokens caem, a senha dela fica', async () => {
      const { svc, contas } = build({ id: 5, login: 'p@x.com', password: '$2b$04$antiga', is_sindico: 0, is_morador: 0, equipeAqui: true }, { moradores: 1 });
      await svc.changePassword(3, 'senha-antiga-da-portaria', 'Nova#123', undefined, sessao);
      expect(contas[0].password).toBe('$2b$04$antiga');
      expect(contas[0].senha_alterada_em).toBeInstanceOf(Date);
    });

    it('conta com o mesmo e-mail que não é da equipe daqui não é tocada', async () => {
      const { svc, prisma } = build({ id: 9, login: 'p@x.com', password: '$2b$04$dele', is_sindico: 0, is_morador: 0, equipeAqui: false });
      await svc.changePassword(3, 'senha-antiga-da-portaria', 'Nova#123', undefined, sessao);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.update).toHaveBeenCalled();
    });

    it.each([
      [undefined, 'Nova#123', 'Informe a senha atual.'],
      ['senha-antiga-da-portaria', undefined, 'A nova senha deve ter no mínimo 6 caracteres.'],
      ['senha-antiga-da-portaria', '12345', 'A nova senha deve ter no mínimo 6 caracteres.'],
      ['senha-antiga-da-portaria', { not: '' }, 'A nova senha deve ter no mínimo 6 caracteres.'],
    ])('senha atual %p / nova %p → 400 "%s", nada gravado', async (atual, nova, msg) => {
      const { svc, prisma } = build(null);
      const p = svc.changePassword(3, atual as any, nova as any, undefined, sessao);
      await expect(p).rejects.toBeInstanceOf(BadRequestException);
      await expect(p).rejects.toThrow(msg);
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
    });
  });
});
