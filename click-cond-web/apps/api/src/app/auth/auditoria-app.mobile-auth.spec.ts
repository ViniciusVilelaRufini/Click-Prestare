import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { MobileAuthService, mascararLogin } from './mobile-auth.service';

/**
 * O token do app não traz id_condominio: o AuditInterceptor não sabe o condomínio e não grava nada
 * nas rotas do app sem :idCondominio na URL nem id_condominio no corpo. Login, senha errada, troca e
 * redefinição de senha, exclusão de morador/funcionário e exclusão da própria conta pelo app não
 * deixavam rastro. Agora o service grava pelo AuditoriaService, no(s) condomínio(s) do vínculo.
 */
describe('Auditoria das rotas do app (mobile-auth)', () => {
  const SENHA = 'senha-certa';
  let hash: string;
  beforeAll(async () => {
    hash = await bcrypt.hash(SENHA, 4);
  });

  /** Registros disparados sem await: espera a fila esvaziar. */
  const assentar = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };

  function montar(prisma: any, extra: { tenant?: any; facial?: any; mfa?: any } = {}) {
    const registrar = jest.fn(async () => undefined);
    const auditoria: any = { registrar };
    const svc = new MobileAuthService(
      prisma,
      { sign: jest.fn(() => 'tok') } as any,
      {} as any,
      {} as any,
      extra.facial ?? ({ unsyncMoradorExcluido: jest.fn(async () => true) } as any),
      extra.tenant ?? ({ assertEntidade: jest.fn(async () => undefined) } as any),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      extra.mfa,
      undefined,
      undefined,
      auditoria,
      undefined,
    );
    const logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    (svc as any).logger = logger;
    const linhas = () => registrar.mock.calls.map((c: any[]) => c[0]);
    return { svc, registrar, linhas, logger };
  }

  describe('mascararLogin', () => {
    it('e-mail: 2 primeiras letras + domínio; login simples: 2 letras', () => {
      expect(mascararLogin('joaquim@demo.com')).toBe('jo***@demo.com');
      expect(mascararLogin('porteiro1')).toBe('po***');
    });
  });

  describe('login do síndico', () => {
    const conta = () => ({
      id: 42,
      login: 'sind@demo.com',
      email: 'sind@demo.com',
      password: hash,
      sindicos: [{ name: 'Sindica Ana', email: 'sind@demo.com' }],
      sindicosCondominios: [
        { id_condominio: 7, condominio: { ativo: 1, aprovado_em: new Date() } },
        { id_condominio: 8, condominio: { ativo: 1, aprovado_em: new Date() } },
      ],
    });

    it('sucesso: LOGIN em cada condomínio do síndico', async () => {
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => conta()) } };
      const { svc, linhas } = montar(prisma);
      await svc.loginSindico('sind@demo.com', SENHA);
      await assentar();
      expect(linhas()).toEqual([
        expect.objectContaining({ id_condominio: 7, acao: 'LOGIN', modulo: 'auth', usuario_nome: 'Sindica Ana', descricao: 'Login no app (síndico)', detalhes: { metodo: 'senha', app: true } }),
        expect.objectContaining({ id_condominio: 8, acao: 'LOGIN', modulo: 'auth', descricao: 'Login no app (síndico)' }),
      ]);
    });

    it('senha errada: LOGIN_FALHA em cada condomínio, com o login MASCARADO e sem a senha', async () => {
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => conta()) } };
      const { svc, linhas } = montar(prisma);
      await expect(svc.loginSindico('sind@demo.com', 'ERRADA-xyz')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(linhas()).toEqual([
        expect.objectContaining({ id_condominio: 7, acao: 'LOGIN_FALHA', descricao: 'Tentativa de login com senha incorreta no app', detalhes: { metodo: 'senha', app: true, login: 'si***@demo.com' } }),
        expect.objectContaining({ id_condominio: 8, acao: 'LOGIN_FALHA' }),
      ]);
      expect(JSON.stringify(linhas())).not.toContain('ERRADA-xyz');
    });

    it('conta inexistente: nada em audit_logs, warn com o login mascarado', async () => {
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => null) } };
      const { svc, linhas, logger } = montar(prisma);
      await expect(svc.loginSindico('fulano@demo.com', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(linhas()).toEqual([]);
      const msg = logger.warn.mock.calls.map((c: any[]) => c[0]).join('\n');
      expect(msg).toContain('LOGIN_FALHA_CONTA_INEXISTENTE');
      expect(msg).toContain('fu***@demo.com');
      expect(msg).not.toContain('fulano@demo.com');
    });

    it('no máximo 10 condomínios', async () => {
      const c = conta();
      c.sindicosCondominios = Array.from({ length: 14 }, (_, i) => ({ id_condominio: i + 1, condominio: { ativo: 1, aprovado_em: new Date() } }));
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => c) } };
      const { svc, linhas } = montar(prisma);
      await svc.loginSindico('sind@demo.com', SENHA);
      await assentar();
      expect(linhas()).toHaveLength(10);
    });

    it('a falha da auditoria não derruba o login', async () => {
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => conta()) } };
      const { svc, registrar } = montar(prisma);
      registrar.mockRejectedValue(new Error('banco fora'));
      await expect(svc.loginSindico('sind@demo.com', SENHA)).resolves.toEqual(expect.objectContaining({ token: 'tok' }));
      await assentar();
    });
  });

  describe('login do morador', () => {
    const conta = () => ({
      id: 50,
      login: 'mor@demo.com',
      email: 'mor@demo.com',
      password: hash,
      moradores: [{ nome: 'Morador Beto', id_condominio: 3, condominio: { ativo: 1, aprovado_em: new Date() } }],
      apartamentosUsers: [
        { apartamento: { id_condominio: 3, condominio: { ativo: 1, aprovado_em: new Date() } } },
        { apartamento: { id_condominio: 4, condominio: { ativo: 1, aprovado_em: new Date() } } },
      ],
    });

    it('sucesso: LOGIN em cada condomínio (Moradores + unidades), sem repetir', async () => {
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => conta()) } };
      const { svc, linhas } = montar(prisma);
      await svc.loginMorador('mor@demo.com', SENHA);
      await assentar();
      expect(linhas().map((l: any) => [l.id_condominio, l.acao, l.descricao, l.usuario_nome])).toEqual([
        [3, 'LOGIN', 'Login no app (morador)', 'Morador Beto'],
        [4, 'LOGIN', 'Login no app (morador)', 'Morador Beto'],
      ]);
    });

    it('senha errada: LOGIN_FALHA', async () => {
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => conta()) } };
      const { svc, linhas } = montar(prisma);
      await expect(svc.loginMorador('mor@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(linhas().map((l: any) => [l.id_condominio, l.acao])).toEqual([[3, 'LOGIN_FALHA'], [4, 'LOGIN_FALHA']]);
    });

    it('conta inexistente: só o warn', async () => {
      const prisma: any = { isConnected: true, users: { findFirst: jest.fn(async () => null) } };
      const { svc, linhas, logger } = montar(prisma);
      await expect(svc.loginMorador('zz@demo.com', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(linhas()).toEqual([]);
      expect(logger.warn.mock.calls.map((c: any[]) => c[0]).join('\n')).toContain('LOGIN_FALHA_CONTA_INEXISTENTE');
    });
  });

  describe('login do funcionário', () => {
    const conta = () => ({
      id: 60,
      login: 'func@demo.com',
      email: 'func@demo.com',
      password: hash,
      photo: null,
      funcionarios: [{ nome: 'Func Caio', id_condominio: 5, condominio: { ativo: 1, aprovado_em: new Date() } }],
    });
    const prismaCom = (user: any, portaria: any = null) => ({
      isConnected: true,
      users: { findFirst: jest.fn(async () => user), findUnique: jest.fn(async () => user) },
      // loginPortariaDesativadoNoCondominio: sem linha de portaria desativada.
      funcionarios_Portaria: { findFirst: jest.fn(async () => portaria), findMany: jest.fn(async () => []) },
    });

    it('sucesso: LOGIN no condomínio do vínculo', async () => {
      const prisma: any = prismaCom(conta());
      const { svc, linhas } = montar(prisma);
      await svc.loginFuncionario('func@demo.com', SENHA);
      await assentar();
      expect(linhas()).toEqual([
        expect.objectContaining({ id_condominio: 5, acao: 'LOGIN', descricao: 'Login no app (funcionário)', usuario_nome: 'Func Caio' }),
      ]);
    });

    it('senha errada (sem login de portaria): LOGIN_FALHA no condomínio do vínculo', async () => {
      const { svc, linhas } = montar(prismaCom(conta()));
      await expect(svc.loginFuncionario('func@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(linhas().map((l: any) => [l.id_condominio, l.acao])).toEqual([[5, 'LOGIN_FALHA']]);
    });

    it('só login de portaria, senha errada: LOGIN_FALHA no condomínio da portaria', async () => {
      const portaria = { id: 9, nome: 'Porteiro Davi', login: 'port@demo.com', password: hash, id_condominio: 6, condominio: { ativo: 1, aprovado_em: new Date() } };
      const { svc, linhas } = montar(prismaCom(null, portaria));
      await expect(svc.loginFuncionario('port@demo.com', 'errada')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(linhas()).toEqual([expect.objectContaining({ id_condominio: 6, acao: 'LOGIN_FALHA', usuario_nome: 'Porteiro Davi' })]);
    });

    it('nem conta nem portaria: só o warn', async () => {
      const { svc, linhas, logger } = montar(prismaCom(null, null));
      await expect(svc.loginFuncionario('nada@demo.com', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
      await assentar();
      expect(linhas()).toEqual([]);
      expect(logger.warn.mock.calls.map((c: any[]) => c[0]).join('\n')).toContain('LOGIN_FALHA_CONTA_INEXISTENTE');
    });
  });

  describe('exclusões pelo app', () => {
    const sindico = { sub: 9, nome: 'Síndico Zeca', typeAccess: 'Sindico', user: { id: 9, nome: 'Síndico Zeca' } } as any;

    it('removeMorador: DELETE em moradores com nome e unidade, sem "Bloco Bloco"', async () => {
      const prisma: any = {
        isConnected: true,
        moradores: {
          findUnique: jest.fn(async () => ({ id: 31, nome: 'Fulano', id_user: 70, id_condominio: 2, bloco: 'Bloco A', apartamento: '106', face_id: null })),
          delete: jest.fn(async () => ({})),
        },
        apartamentos: { findMany: jest.fn(async () => [{ id: 1 }]) },
        apartamentos_Users: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      };
      prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
      const { svc, linhas } = montar(prisma);
      (svc as any).exigirFlagFuncionario = jest.fn(async () => undefined);
      await svc.removeMorador(31, sindico);
      await assentar();
      expect(linhas()).toEqual([
        expect.objectContaining({
          id_condominio: 2,
          acao: 'DELETE',
          modulo: 'moradores',
          entidade_id: 31,
          usuario_nome: 'Síndico Zeca',
          descricao: 'Removeu o morador "Fulano" (Bloco A, Apto 106)',
        }),
      ]);
    });

    it('removeMorador que falha no banco não grava DELETE', async () => {
      const prisma: any = {
        isConnected: true,
        moradores: { findUnique: jest.fn(async () => ({ id: 31, nome: 'Fulano', id_user: 70, id_condominio: 2, bloco: 'A', apartamento: '106' })) },
        $transaction: jest.fn(async () => {
          throw Object.assign(new Error('fk'), { code: 'P2003' });
        }),
      };
      const { svc, linhas } = montar(prisma);
      (svc as any).exigirFlagFuncionario = jest.fn(async () => undefined);
      await expect(svc.removeMorador(31, sindico)).rejects.toBeTruthy();
      await assentar();
      expect(linhas()).toEqual([]);
    });

    it('removeFuncionario: DELETE em funcionarios com o nome', async () => {
      const prisma: any = {
        isConnected: true,
        funcionarios_Portaria: {
          findUnique: jest.fn(async () => ({ id: 50, nome: 'Porteiro Zé', login: 'p@test', id_condominio: 1 })),
          delete: jest.fn(async () => ({})),
        },
        users: { findFirst: jest.fn(async () => null) },
      };
      prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
      const { svc, linhas } = montar(prisma);
      await svc.removeFuncionario(50, sindico);
      await assentar();
      expect(linhas()).toEqual([
        expect.objectContaining({ id_condominio: 1, acao: 'DELETE', modulo: 'funcionarios', entidade_id: 50, descricao: 'Removeu o funcionário "Porteiro Zé"' }),
      ]);
    });

    it('deleteAccount: DELETE em users em cada condomínio do vínculo, depois do DELETE', async () => {
      const ordem: string[] = [];
      const prisma: any = {
        isConnected: true,
        users: { findUnique: jest.fn(async () => ({ login: 'm@t', email: 'm@t', name: 'Conta Maria' })) },
        funcionarios_Portaria: { deleteMany: jest.fn(async () => ({ count: 0 })) },
        funcionarios: { findMany: jest.fn(async () => [{ id_condominio: 4 }]) },
        sindicos_Condominios: { findMany: jest.fn(async () => []) },
        moradores: { findMany: jest.fn(async () => [{ id: 11, face_id: null, id_condominio: 1, nome: 'Maria' }]) },
        apartamentos_Users: { findMany: jest.fn(async () => [{ apartamento: { id_condominio: 1 } }]) },
        financeiro: { updateMany: jest.fn(async () => ({ count: 0 })) },
        $executeRaw: jest.fn(async () => {
          ordem.push('delete');
          return 1;
        }),
        $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
      };
      const { svc, registrar, linhas } = montar(prisma);
      registrar.mockImplementation(async () => {
        ordem.push('audit');
      });
      await svc.deleteAccount(5);
      await assentar();
      expect(linhas().map((l: any) => [l.id_condominio, l.acao, l.modulo, l.entidade_id, l.descricao])).toEqual([
        [4, 'DELETE', 'users', 5, 'Conta excluída pelo próprio usuário'],
        [1, 'DELETE', 'users', 5, 'Conta excluída pelo próprio usuário'],
      ]);
      expect(linhas()[0].usuario_nome).toBe('Conta Maria');
      expect(ordem.indexOf('audit')).toBeGreaterThan(ordem.indexOf('delete'));
    });

    it('deleteAccount sem vínculo nenhum: nada (nunca id_condominio 0)', async () => {
      const prisma: any = {
        isConnected: true,
        users: { findUnique: jest.fn(async () => ({ login: 'm@t', email: 'm@t', name: 'X' })) },
        funcionarios_Portaria: { deleteMany: jest.fn() },
        funcionarios: { findMany: jest.fn(async () => []) },
        sindicos_Condominios: { findMany: jest.fn(async () => []) },
        moradores: { findMany: jest.fn(async () => []) },
        apartamentos_Users: { findMany: jest.fn(async () => []) },
        financeiro: { updateMany: jest.fn(async () => ({ count: 0 })) },
        $executeRaw: jest.fn(async () => 1),
        $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
      };
      const { svc, linhas } = montar(prisma);
      await svc.deleteAccount(5);
      await assentar();
      expect(linhas()).toEqual([]);
    });
  });

  describe('troca de senha pelo app (new-password)', () => {
    it('UPDATE em auth em todos os condomínios da conta, sem senha nem ip', async () => {
      const prisma: any = {
        isConnected: true,
        users: {
          findUnique: jest.fn(async () => ({ id: 9, login: 's@t', password: hash })),
          update: jest.fn(async () => ({
            id: 9, login: 's@t', name: 'Sindica Ana', photo: null,
            sindicos: [{ name: 'Sindica Ana' }], moradores: [], funcionarios: [], sindicosCondominios: [{ id_condominio: 2 }],
          })),
        },
        sindicos_Condominios: { findMany: jest.fn(async () => [{ id_condominio: 2 }, { id_condominio: 3 }]) },
        moradores: { findMany: jest.fn(async () => []) },
        apartamentos_Users: { findMany: jest.fn(async () => []) },
        funcionarios: { findMany: jest.fn(async () => []) },
        credenciais_Acesso: { updateMany: jest.fn(async () => ({ count: 0 })) },
      };
      const { svc, linhas } = montar(prisma);
      await svc.updatePassword(9, 'NovaSenha#1', 'Sindico', SENHA);
      await assentar();
      expect(linhas()).toEqual([
        expect.objectContaining({ id_condominio: 2, acao: 'UPDATE', modulo: 'auth', entidade_id: 9, descricao: 'Senha alterada pelo app', usuario_nome: 'Sindica Ana' }),
        expect.objectContaining({ id_condominio: 3, acao: 'UPDATE', modulo: 'auth', descricao: 'Senha alterada pelo app' }),
      ]);
      for (const l of linhas()) expect(l.ip).toBeUndefined();
      expect(JSON.stringify(linhas())).not.toContain('NovaSenha#1');
    });
  });
});
