import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrestadoresService } from './prestadores.service';

/**
 * Rodada 1 da revisão de A4/A5, com um banco em memória para seguir o estado entre chamadas:
 *
 * I1 — Trocar o e-mail de quem tem login levava o Funcionarios_Portaria para o e-mail novo (e, com a chave, criava
 *      Users + Funcionarios novos), mas a conta antiga seguia com o próprio Funcionarios e a mesma senha. A revogação
 *      depois só achava a conta nova; a antiga continuava entrando no app e no console pelo QR.
 * I2 — "Novo" com o nome de um prestador que tem login caía no upsert por nome e gravava email=null no cadastro sem
 *      checar alçada: login, Users e Funcionarios ficavam vivos e o síndico perdia o caminho para revogar.
 * I3 — Revogar e religar a chave com o mesmo e-mail dava 400 "Já existe uma conta com este e-mail": a revogação
 *      mantém o Users (nunca apagamos) e a checagem exigia Funcionarios neste condomínio.
 * (6) — Users.login e Users.email são únicos cada um: login OU e-mail pode achar duas contas; vale a da equipe daqui.
 */
describe('Prestador × login de portaria — troca de e-mail, upsert por nome e reconcessão', () => {
  const sindico = { sub: 51, nome: 'Síndico', id_condominio: 1, typeAccess: 'Sindico' } as any;
  const porteiro = { sub: 3, nome: 'Porteiro A', id_condominio: 1, turno: 'Diurno', tipo_sub: 'funcionario_portaria' } as any;

  type Linha = Record<string, any>;
  function banco(extra: { users?: Linha[]; func?: Linha[]; moradores?: Linha[] } = {}) {
    const db = {
      prestadores: [
        { id: 1, nome: 'Eletricista', email: 'a@x.com', telefone: null, categorias: null, id_condominio: 1, id_apartamento: null,
          face_id: null, foto_pessoa: null, foto_documento: null, dias_semana: null },
      ] as Linha[],
      fp: [
        { id: 12, nome: 'Eletricista', login: 'a@x.com', email: 'a@x.com', telefone: null, turno: 'Geral', ativo: 1, id_condominio: 1, password: '$2b$04$doLogin' },
      ] as Linha[],
      users: [
        { id: 5, login: 'a@x.com', email: 'a@x.com', password: '$2b$04$antiga', is_funcionario: 1, is_sindico: 0, is_morador: 0, senha_alterada_em: null },
        ...(extra.users ?? []),
      ] as Linha[],
      func: [{ id: 77, id_user: 5, id_condominio: 1 }, ...(extra.func ?? [])] as Linha[],
      sindicos: [] as Linha[],
      sindCond: [] as Linha[],
      moradores: (extra.moradores ?? []) as Linha[],
      aptUsers: [] as Linha[],
    };
    let seq = 1000;
    const casa = (row: Linha, where: Linha = {}): boolean =>
      Object.entries(where).every(([k, v]) => {
        if (k === 'OR') return (v as Linha[]).some((w) => casa(row, w));
        if (k === 'funcionarios') return db.func.some((f) => f.id_user === row.id && casa(f, v.some));
        if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
        return row[k] === v;
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
      count: jest.fn(async ({ where }: any = {}) => rows.filter((x) => casa(x, where)).length),
      create: jest.fn(async ({ data }: any) => {
        const r = { id: ++seq, ...data };
        rows.push(r);
        return { ...r };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => casa(x, where));
        if (!r) throw new Error('registro não encontrado');
        Object.assign(r, data);
        return { ...r };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = rows.findIndex((x) => casa(x, where));
        if (i < 0) throw new Error('registro não encontrado');
        return rows.splice(i, 1)[0];
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const antes = rows.length;
        const fica = rows.filter((x) => !casa(x, where));
        rows.splice(0, rows.length, ...fica);
        return { count: antes - fica.length };
      }),
    });
    const prisma: any = {
      isConnected: true,
      prestadores_servico: tabela(db.prestadores),
      funcionarios_Portaria: tabela(db.fp),
      users: tabela(db.users),
      funcionarios: tabela(db.func),
      sindicos: tabela(db.sindicos),
      sindicos_Condominios: tabela(db.sindCond),
      moradores: tabela(db.moradores),
      apartamentos_Users: tabela(db.aptUsers),
    };
    const tenant: any = {
      assertCondominio: jest.fn(async () => undefined),
      assertEntidade: jest.fn(async () => undefined),
      assertPermissaoFuncionario: jest.fn(async () => undefined),
    };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const facial: any = { syncPrestadorServico: jest.fn(async () => ({})), unsyncPrestadorServico: jest.fn(async () => ({})) };
    return { svc: new PrestadoresService(prisma, storage, facial, tenant), db, prisma };
  }

  const equipeAqui = (db: any) => db.func.filter((f: Linha) => f.id_condominio === 1);
  const conta = (db: any, id: number) => db.users.find((u: Linha) => u.id === id);

  describe('I1 — trocar o e-mail de quem tem login desliga a conta antiga', () => {
    it('troca a@→b@ sem a chave e depois desliga a chave: nenhuma conta fica na equipe deste condomínio', async () => {
      const { svc, db } = banco();
      await svc.update(1, { email: 'b@x.com' }, 1, sindico);
      // A conta antiga sai da equipe no mesmo ato e os tokens dela caem.
      expect(equipeAqui(db)).toHaveLength(0);
      expect(conta(db, 5).senha_alterada_em).toBeInstanceOf(Date);
      // O login de portaria acompanha o e-mail novo.
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'b@x.com' })]);

      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(equipeAqui(db)).toHaveLength(0);
      expect(db.fp).toHaveLength(0);
      expect(db.users).toHaveLength(1); // nunca apaga Users
    });

    it('troca a@→b@ com a chave e senha nova e depois desliga a chave: nenhuma das duas contas fica na equipe', async () => {
      const { svc, db } = banco();
      await svc.update(1, { email: 'b@x.com', hasPortariaAccess: true, senha: 'Nova#123' }, 1, sindico);
      const nova = db.users.find((u: Linha) => u.login === 'b@x.com');
      expect(nova).toBeTruthy();
      expect(equipeAqui(db).map((f: Linha) => f.id_user)).toEqual([nova!.id]); // só a conta nova
      expect(conta(db, 5).senha_alterada_em).toBeInstanceOf(Date);

      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(equipeAqui(db)).toHaveLength(0);
      expect(db.fp).toHaveLength(0);
      expect(db.users).toHaveLength(2);
    });
  });

  describe('I2 — "Novo" com o nome de quem tem login (upsert por nome)', () => {
    it('porteiro: o e-mail gravado fica (vazio ou outro), login e conta seguem vivos; os campos comuns atualizam', async () => {
      for (const email of ['', 'meu@x.com']) {
        const { svc, db } = banco();
        await svc.create({ id_condominio: 1, nome: 'Eletricista', email, telefone: '(11) 9999', hasPortariaAccess: false } as any, porteiro);
        expect(db.prestadores[0]).toEqual(expect.objectContaining({ email: 'a@x.com', telefone: '(11) 9999' }));
        expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'a@x.com' })]);
        expect(equipeAqui(db)).toHaveLength(1);
        expect(conta(db, 5).senha_alterada_em).toBeNull();
      }
    });

    // O upsert nunca revoga: a tela nem mostra o e-mail com a chave desligada, e recadastrar um nome não pode
    // derrubar o acesso por acidente. Revogar é pelo update com a chave desligada ou pelo remover.
    it.each([[''], [undefined]])('síndico com o e-mail %p: preserva e-mail, login, equipe e tokens; os campos comuns atualizam', async (email) => {
      const { svc, db } = banco();
      await svc.create({ id_condominio: 1, nome: 'Eletricista', email, telefone: '(11) 8888', hasPortariaAccess: false } as any, sindico);
      expect(db.prestadores[0]).toEqual(expect.objectContaining({ email: 'a@x.com', telefone: '(11) 8888' }));
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'a@x.com', ativo: 1 })]);
      expect(equipeAqui(db)).toHaveLength(1);
      expect(conta(db, 5).senha_alterada_em).toBeNull();
    });

    it('síndico com outro e-mail: a conta antiga sai da equipe e o login acompanha o e-mail novo', async () => {
      const { svc, db } = banco();
      await svc.create({ id_condominio: 1, nome: 'Eletricista', email: 'b@x.com', hasPortariaAccess: false } as any, sindico);
      expect(db.prestadores[0].email).toBe('b@x.com');
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'b@x.com' })]);
      expect(equipeAqui(db)).toHaveLength(0);
      expect(conta(db, 5).senha_alterada_em).toBeInstanceOf(Date);
    });
  });

  describe('I3 — religar a chave depois de revogar', () => {
    it('conta só de equipe: reconcede, recria o vínculo e a senha do app passa a ser a nova', async () => {
      const { svc, db } = banco();
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(equipeAqui(db)).toHaveLength(0);
      conta(db, 5).senha_alterada_em = null;

      await svc.update(1, { hasPortariaAccess: true, senha: 'Volta#123' }, 1, sindico);
      expect(db.fp).toEqual([expect.objectContaining({ login: 'a@x.com', turno: 'Geral', ativo: 1 })]);
      expect(equipeAqui(db).map((f: Linha) => f.id_user)).toEqual([5]);
      expect(await bcrypt.compare('Volta#123', conta(db, 5).password)).toBe(true);
      expect(await bcrypt.compare('Volta#123', db.fp[0].password)).toBe(true);
      expect(conta(db, 5).senha_alterada_em).toBeInstanceOf(Date);
      expect(db.users).toHaveLength(1);
    });

    it.each([
      ['também é morador', { moradores: [{ id: 1, id_user: 5, id_condominio: 2 }] }, {}],
      ['veio do cadastro público (sem is_funcionario)', {}, { is_funcionario: 0 }],
      ['é da equipe de outro condomínio', { func: [{ id: 78, id_user: 5, id_condominio: 2 }] }, {}],
    ])('conta que %s: segue recusada e a senha não é tocada', async (_n, extra, patch) => {
      const { svc, db } = banco(extra as any);
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      Object.assign(conta(db, 5), patch);
      const senhaAntes = conta(db, 5).password;

      await expect(svc.update(1, { hasPortariaAccess: true, senha: 'Volta#123' }, 1, sindico)).rejects.toThrow(
        new BadRequestException('Já existe uma conta com este e-mail. Use outro e-mail para o acesso à portaria.'),
      );
      expect(conta(db, 5).password).toBe(senhaAntes);
      expect(db.fp).toHaveLength(0);
      expect(equipeAqui(db)).toHaveLength(0);
    });
  });

  it('(8) a lista diz se o cadastro tem login próprio, mesmo inativo (é o que faz remover exigir síndico)', async () => {
    const { svc, db } = banco();
    db.fp[0].ativo = 0;
    const [p] = await svc.findAll(1, undefined, sindico);
    expect(p).toEqual(expect.objectContaining({ hasPortariaAccess: false, loginPortariaProprio: true }));
    await expect(svc.remove(1, 1, porteiro)).rejects.toThrow('exige síndico');
  });

  it('(6) login e e-mail achando contas diferentes: a revogação vale para a conta da equipe daqui', async () => {
    // Conta 4 tem 'a@x.com' como e-mail (outra pessoa, sem equipe aqui); a conta 5 do login é a da equipe.
    const { svc, db } = banco();
    conta(db, 5).email = 'pessoal@x.com';
    db.users.unshift({ id: 4, login: 'outro-login', email: 'a@x.com', password: 'x', is_funcionario: 0, is_sindico: 0, is_morador: 1, senha_alterada_em: null });
    await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
    expect(equipeAqui(db)).toHaveLength(0);
    expect(conta(db, 5).senha_alterada_em).toBeInstanceOf(Date);
    expect(conta(db, 4).senha_alterada_em).toBeNull();
  });
});
