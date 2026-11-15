import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MobileAuthService } from './mobile-auth.service';
import { JwtStrategy } from './jwt.strategy';
import { carimboCredencialPortaria } from './credencial-portaria.util';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { EquipePortariaController } from './equipe-portaria.controller';
import { UsuarioAppGuard } from './usuario-app.guard';

/**
 * Rodada 4 (raia e), item 1 — aba "Equipe da portaria" do console (r3-s, M9).
 *
 * A lista "Funcionários" do console é de prestadores; os logins de portaria cadastrados pelo app (e os dados pelo
 * cadastro de prestador) não apareciam em lugar nenhum do console. A aba lista todos os logins de portaria do
 * condomínio e deixa o SÍNDICO (assertSindicoEstrito: pelo typeAccess, nunca pelo turno) ativar/desativar e mudar o
 * turno. Desativar derruba a sessão aberta do porteiro pelo JwtStrategy.porteiroAtivo (até 30 s de cache).
 */
describe('Equipe da portaria (console) — listar, ativar/desativar e turno', () => {
  const sindico = { sub: 51, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;
  const sindicoApp = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 51 } } as any;
  const porteiro = { sub: 12, nome: 'Ana', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' } as any;
  const porteiroTurnoSindico = { sub: 13, nome: 'Bia', id_condominio: 1, turno: 'Síndico', tipo_sub: 'funcionario_portaria' } as any;
  const funcionarioQr = { sub: 60, nome: 'Caio', id_condominio: 1, turno: 'Porteiro (App)', typeAccess: 'Funcionario' } as any;

  type Linha = Record<string, any>;
  function banco() {
    const db = {
      fp: [
        { id: 12, nome: 'Ana', login: 'ana@x.com', email: 'ana@x.com', telefone: '1', turno: 'Diurno', ativo: 1, id_condominio: 1, password: '$2b$04$ana' },
        { id: 13, nome: 'Eletricista', login: 'ele@x.com', email: 'ele@x.com', telefone: null, turno: 'Geral', ativo: 0, id_condominio: 1, password: '$2b$04$ele' },
        { id: 14, nome: 'Síndico', login: 'sind@x.com', email: 'sind@x.com', telefone: null, turno: 'Síndico', ativo: 1, id_condominio: 1, password: '$2b$04$s' },
        // Login de prestador cujo turno E nome o síndico mudou pelo app: o cadastro do prestador não o reconhece mais.
        { id: 15, nome: 'Zé Noite', login: 'jose@x.com', email: 'jose@x.com', telefone: null, turno: 'Noturno', ativo: 1, id_condominio: 1, password: '$2b$04$j' },
        { id: 20, nome: 'De outro prédio', login: 'out@x.com', email: 'out@x.com', telefone: null, turno: 'Diurno', ativo: 1, id_condominio: 2, password: '$2b$04$o' },
      ] as Linha[],
      prestadores: [
        { id: 1, nome: 'Eletricista', email: 'ele@x.com', id_condominio: 1 },
        { id: 2, nome: 'José Silva', email: 'jose@x.com', id_condominio: 1 },
      ] as Linha[],
      users: [
        { id: 5, login: 'ana@x.com', email: 'ana@x.com', password: '$2b$04$contaAna', senha_alterada_em: null, sindico: false },
        { id: 51, login: 'sind@x.com', email: 'sind@x.com', password: '$2b$04$contaSind', senha_alterada_em: null, sindico: true },
      ] as Linha[],
      func: [
        { id: 70, id_user: 5, id_condominio: 1, ch: 'Diurno' },
        { id: 71, id_user: 5, id_condominio: 2, ch: 'Diurno' },
      ] as Linha[],
      logins: [
        { autor_tipo: 'funcionario_portaria', autor_id: 12, created_at: new Date('2026-11-10T10:00:00Z') },
        { autor_tipo: 'funcionario_portaria', autor_id: 12, created_at: new Date('2026-11-12T08:30:00Z') },
      ] as Linha[],
    };
    const em = (v: any, x: any) => (v && typeof v === 'object' && 'in' in v ? v.in.includes(x) : v === x);
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: {
        findMany: jest.fn(async ({ where }: any) => db.fp.filter((f) => f.id_condominio === where.id_condominio).map((f) => ({ ...f }))),
        findFirst: jest.fn(async ({ where }: any) => {
          const f = db.fp.find((x) => Object.entries(where).every(([k, v]) => k === 'condominio' || em(v, x[k])));
          return f ? { ...f } : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const f = db.fp.find((x) => x.id === where.id)!;
          Object.assign(f, data);
          return { ...f };
        }),
      },
      prestadores_servico: {
        findMany: jest.fn(async ({ where }: any) =>
          db.prestadores.filter((p) => p.id_condominio === where.id_condominio && em(where.email, p.email)).map((p) => ({ ...p })),
        ),
      },
      users: {
        findMany: jest.fn(async ({ where }: any) =>
          db.users.filter((u) => em(where.login, u.login) && (!where.sindicosCondominios || u.sindico)).map((u) => ({ ...u })),
        ),
        findFirst: jest.fn(async ({ where }: any) => {
          const u = db.users.find((x) => em(where.login, x.login));
          return u ? { ...u } : null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const u = db.users.find((x) => x.id === where.id);
          return u ? { ...u } : null;
        }),
        update: jest.fn(),
      },
      funcionarios: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const alvo = db.func.filter((f) => f.id_user === where.id_user && f.id_condominio === where.id_condominio);
          alvo.forEach((f) => Object.assign(f, data));
          return { count: alvo.length };
        }),
      },
      auditLog: {
        groupBy: jest.fn(async ({ where }: any) => {
          const linhas = db.logins.filter(
            (l) => l.autor_tipo === where.autor_tipo && where.autor_id.in.includes(l.autor_id) && l.created_at >= where.created_at.gte,
          );
          const ids = [...new Set(linhas.map((l) => l.autor_id))];
          return ids.map((id) => ({
            autor_id: id,
            _max: { created_at: new Date(Math.max(...linhas.filter((l) => l.autor_id === id).map((l) => +l.created_at))) },
          }));
        }),
      },
    };
    prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(
      prisma, {} as any, {} as any, {} as any, {} as any, tenant, {} as any, {} as any, {} as any, {} as any,
      undefined, undefined, undefined, auditoria,
    );
    return { svc, db, prisma, tenant, auditoria };
  }

  it('controller: rotas sob condominios/:idCondominio/portaria/equipe, sem o guard do app, delegando ao service', async () => {
    const svc: any = { listarEquipePortaria: jest.fn(async () => []), alterarLoginPortaria: jest.fn(async () => ({})) };
    const ctrl = new EquipePortariaController(svc);
    expect(Reflect.getMetadata(PATH_METADATA, EquipePortariaController)).toBe('condominios/:idCondominio/portaria/equipe');
    expect(Reflect.getMetadata(GUARDS_METADATA, EquipePortariaController) ?? []).not.toContain(UsuarioAppGuard);
    await ctrl.listar(1, sindico);
    await ctrl.alterar(1, 12, { ativo: false }, sindico);
    expect(svc.listarEquipePortaria).toHaveBeenCalledWith(1, sindico);
    expect(svc.alterarLoginPortaria).toHaveBeenCalledWith(1, 12, { ativo: false }, sindico);
  });

  describe('quem pode', () => {
    it.each([
      ['porteiro do console', porteiro],
      ['porteiro com "Síndico" escrito no turno', porteiroTurnoSindico],
      ['funcionário que entrou pelo QR', funcionarioQr],
      ['sem sessão', undefined],
    ])('%s → 403 na lista e na alteração, sem ler nem gravar nada', async (_n, user) => {
      const { svc, prisma, db } = banco();
      await expect(svc.listarEquipePortaria(1, user)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.alterarLoginPortaria(1, 12, { ativo: false }, user)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.funcionarios_Portaria.findMany).not.toHaveBeenCalled();
      expect(prisma.funcionarios_Portaria.update).not.toHaveBeenCalled();
      expect(db.fp[0].ativo).toBe(1);
    });

    it('síndico do console e do app passam, e o condomínio é conferido', async () => {
      for (const u of [sindico, sindicoApp]) {
        const { svc, tenant } = banco();
        await svc.listarEquipePortaria(1, u);
        expect(tenant.assertCondominio).toHaveBeenCalledWith(1, u);
      }
    });
  });

  describe('lista', () => {
    it('todos os logins de portaria DESTE condomínio, ativos e inativos, com origem e último acesso', async () => {
      const { svc } = banco();
      const lista = await svc.listarEquipePortaria(1, sindico);
      expect(lista.map((f: any) => f.id).sort()).toEqual([12, 13, 14, 15]); // o 20 é de outro condomínio
      const porId = Object.fromEntries(lista.map((f: any) => [f.id, f]));
      expect(porId[12]).toEqual(expect.objectContaining({
        nome: 'Ana', login: 'ana@x.com', email: 'ana@x.com', turno: 'Diurno', ativo: true, origem: 'app',
        ultimo_acesso: new Date('2026-11-12T08:30:00Z'), sindico: false, voce: false,
      }));
      expect(porId[13]).toEqual(expect.objectContaining({ ativo: false, origem: 'prestador', prestador: { id: 1, nome: 'Eletricista' }, ultimo_acesso: null }));
      expect(porId[14]).toEqual(expect.objectContaining({ sindico: true, voce: true }));
      // O login que o cadastro do prestador não reconhece mais (turno e nome mudados pelo app) aparece aqui.
      expect(porId[15]).toEqual(expect.objectContaining({ origem: 'app', prestador: null, email_de_prestador: true }));
      expect(lista[0]).not.toHaveProperty('password');
    });

    it('último acesso: vale o login por QR (conta do app) quando é o mais recente; fora de 90 dias não conta', async () => {
      const { svc, db, prisma } = banco();
      const agora = Date.now();
      db.logins.splice(0, db.logins.length,
        { autor_tipo: 'funcionario_portaria', autor_id: 12, created_at: new Date(agora - 5 * 86400000) },
        { autor_tipo: 'user', autor_id: 5, created_at: new Date(agora - 86400000) }, // QR da Ana (Users 5)
        { autor_tipo: 'funcionario_portaria', autor_id: 15, created_at: new Date(agora - 120 * 86400000) },
      );
      const porId = Object.fromEntries((await svc.listarEquipePortaria(1, sindico)).map((f: any) => [f.id, f]));
      expect(porId[12].ultimo_acesso).toEqual(new Date(agora - 86400000));
      expect(porId[15].ultimo_acesso).toBeNull();
      for (const [args] of prisma.auditLog.groupBy.mock.calls) {
        expect(args.where).toEqual(expect.objectContaining({ id_condominio: 1, acao: 'LOGIN', created_at: { gte: expect.any(Date) } }));
        expect(agora - +args.where.created_at.gte).toBeGreaterThanOrEqual(89 * 86400000);
      }
    });

    it('sem a auditoria (falha na consulta), a lista sai com último acesso vazio', async () => {
      const { svc, prisma } = banco();
      prisma.auditLog.groupBy.mockRejectedValue(new Error('banco instável'));
      const lista = await svc.listarEquipePortaria(1, sindico);
      expect(lista).toHaveLength(4);
      expect(lista.every((f: any) => f.ultimo_acesso === null)).toBe(true);
    });
  });

  describe('ativar / desativar', () => {
    it('desativar grava ativo = 0 e a sessão aberta do porteiro cai no JwtStrategy', async () => {
      const { svc, db, prisma, auditoria } = banco();
      const r = await svc.alterarLoginPortaria(1, 12, { ativo: false }, sindico);
      expect(r).toEqual(expect.objectContaining({ id: 12, ativo: false, turno: 'Diurno' }));
      expect(db.fp[0].ativo).toBe(0);
      expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ id_condominio: 1, acao: 'UPDATE', autor_id: 51, autor_tipo: 'user' }));

      // A mesma consulta do JwtStrategy, contra o banco já alterado (strategy nova = cache vazio, como depois dos 30 s).
      const strategy = new JwtStrategy(prisma);
      (strategy as any).logger = { warn: jest.fn() };
      const token = { ...porteiro, cred: carimboCredencialPortaria({ login: 'ana@x.com', password: '$2b$04$ana' }) };
      await expect(strategy.validate(token)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('reativar grava ativo = 1', async () => {
      const { svc, db } = banco();
      await svc.alterarLoginPortaria(1, 13, { ativo: true }, sindico);
      expect(db.fp[1].ativo).toBe(1);
    });

    it('o síndico não desativa a própria linha de portaria (400), mas muda o turno dela', async () => {
      const { svc, db } = banco();
      await expect(svc.alterarLoginPortaria(1, 14, { ativo: false }, sindico)).rejects.toThrow(
        new BadRequestException('Você não pode desativar o seu próprio acesso.'),
      );
      expect(db.fp[2].ativo).toBe(1);
      await svc.alterarLoginPortaria(1, 14, { turno: 'Comercial' }, sindico);
      expect(db.fp[2].turno).toBe('Comercial');
    });

    it('login de outro condomínio → 404 e nada muda', async () => {
      const { svc, db } = banco();
      await expect(svc.alterarLoginPortaria(1, 20, { ativo: false }, sindico)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.fp[4].ativo).toBe(1);
    });

    it('nada de senha, e-mail ou conta do app é tocado', async () => {
      const { svc, db, prisma } = banco();
      const antes = JSON.parse(JSON.stringify(db.users));
      await svc.alterarLoginPortaria(1, 12, { ativo: false, turno: 'Noturno' }, sindico);
      expect(prisma.users.update).not.toHaveBeenCalled();
      expect(JSON.parse(JSON.stringify(db.users))).toEqual(antes);
      expect(db.fp[0]).toEqual(expect.objectContaining({ login: 'ana@x.com', email: 'ana@x.com', password: '$2b$04$ana' }));
    });
  });

  describe('turno', () => {
    it('muda o turno do login e o turno (ch) do vínculo de equipe DESTE condomínio, não o do outro prédio', async () => {
      const { svc, db } = banco();
      const r = await svc.alterarLoginPortaria(1, 12, { turno: '  Noturno  ' }, sindico);
      expect(r).toEqual(expect.objectContaining({ id: 12, ativo: true, turno: 'Noturno' }));
      expect(db.fp[0].turno).toBe('Noturno');
      expect(db.func.find((f) => f.id === 70)!.ch).toBe('Noturno');
      expect(db.func.find((f) => f.id === 71)!.ch).toBe('Diurno');
    });

    it.each([
      [{}, 'Nada para alterar.'],
      [{ ativo: 'false' }, 'Valor inválido para ativo.'],
      [{ turno: '' }, 'Informe o turno.'],
      [{ turno: 42 }, 'Informe o turno.'],
      [{ turno: 'x'.repeat(21) }, 'O turno deve ter no máximo 20 caracteres.'],
      [{ turno: 'Síndico' }, 'Este turno é reservado.'],
      [{ turno: ' sindico ' }, 'Este turno é reservado.'],
      [{ turno: 'Geral' }, 'Este turno é reservado.'],
    ])('%p → 400 "%s" e nada muda', async (body, msg) => {
      const { svc, db } = banco();
      const antes = JSON.parse(JSON.stringify(db.fp));
      await expect(svc.alterarLoginPortaria(1, 12, body as any, sindico)).rejects.toThrow(new BadRequestException(msg));
      expect(db.fp).toEqual(antes);
    });

    it("sair de 'Geral' num login de prestador com outro nome: o nome da linha vira o do prestador (o elo continua)", async () => {
      const { svc, db, auditoria } = banco();
      db.fp[1].nome = 'Elétrico Zé'; // a concessão copia o nome, mas a linha pode ter sido renomeada
      const r = await svc.alterarLoginPortaria(1, 13, { turno: 'Noturno' }, sindico);
      expect(db.fp[1]).toEqual(expect.objectContaining({ turno: 'Noturno', nome: 'Eletricista' }));
      expect(r).toEqual(expect.objectContaining({ turno: 'Noturno', nome: 'Eletricista' }));
      expect(auditoria.registrar.mock.calls[0][0].descricao).toContain('nome igualado ao do prestador');
      const porId = Object.fromEntries((await svc.listarEquipePortaria(1, sindico)).map((f: any) => [f.id, f]));
      expect(porId[13]).toEqual(expect.objectContaining({ origem: 'prestador', prestador: { id: 1, nome: 'Eletricista' } }));
    });

    it("login 'Geral' sem prestador dono identificável não sai de 'Geral' (400) e nada muda", async () => {
      const { svc, db } = banco();
      db.prestadores.splice(0, 1); // ninguém mais com o e-mail ele@x.com
      await expect(svc.alterarLoginPortaria(1, 13, { turno: 'Noturno' }, sindico)).rejects.toThrow(
        'Este login foi dado pelo cadastro de prestador e não há um prestador com este e-mail para ligá-lo: o turno continua "Geral".',
      );
      expect(db.fp[1].turno).toBe('Geral');
    });

    it("'Geral' pode voltar no login que é do prestador (é o turno que a concessão grava)", async () => {
      const { svc, db } = banco();
      db.fp[1].turno = 'Noturno'; // mesmo nome do prestador: segue sendo dele
      await svc.alterarLoginPortaria(1, 13, { turno: 'geral' }, sindico);
      expect(db.fp[1].turno).toBe('Geral');
    });
  });
});
