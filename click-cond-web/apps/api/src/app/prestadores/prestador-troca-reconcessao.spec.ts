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
 *
 * Rodada 2:
 * - Reconcessão por "conta só de equipe" permitia tomar uma conta órfã de OUTRO condomínio (is_funcionario=1, sem
 *   vínculo): a senha dela virava a de quem concedia. Volta a regra da base (conta existente só se já é da equipe
 *   daqui); a prova de origem é tirada na revogação, que libera login/e-mail (lápide) da conta que era só daqui.
 * - Trocar o e-mail de acesso exige senha nova e grava `email` junto com `login` no login de portaria: com a senha
 *   antiga, o dono do e-mail antigo achava o login pelo app e o vínculo era recriado.
 * - M1: o e-mail do prestador não pode ser o `email` de outro login de portaria deste condomínio.
 *
 * Rodada 3:
 * - A lápide previsível (revogado-<id>@…) podia ser ocupada de antemão pelo signup: a revogação batia no @unique,
 *   e sem transação o vínculo já tinha sido apagado, o login de portaria ficava de pé e o app recriava o vínculo.
 *   Agora: lápide aleatória com nova tentativa, revogação inteira numa transação, e ela nunca falha pela lápide.
 * - Re-credenciar com senha nova uma conta exclusivamente desta equipe troca também a senha do app e derruba os
 *   tokens (senha vazada); conta compartilhada não é tocada.
 * - A lápide libera também o CPF (Users.cpf é @unique e anulável).
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
        { id: 5, login: 'a@x.com', email: 'a@x.com', cpf: '123.456.789-00', password: '$2b$04$antiga', is_funcionario: 1, is_sindico: 0, is_morador: 0, senha_alterada_em: null },
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
        if (k === 'NOT') return !casa(row, v);
        if (k === 'funcionarios') return db.func.some((f) => f.id_user === row.id && casa(f, v.some));
        if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
        return row[k] === v;
      });
    // Users.login, Users.email e Users.cpf são @unique: o banco em memória recusa como o MySQL (P2002).
    const unicos = (rows: Linha[], r: Linha, campos: string[]) => {
      for (const c of campos) {
        if (r[c] != null && rows.some((x) => x !== r && x[c] === r[c])) throw Object.assign(new Error(`unique ${c}`), { code: 'P2002' });
      }
    };
    const tabela = (rows: Linha[], campos: string[] = []) => ({
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
        unicos(rows, r, campos);
        rows.push(r);
        return { ...r };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => casa(x, where));
        if (!r) throw new Error('registro não encontrado');
        for (const c of campos) {
          if (data[c] != null && rows.some((x) => x !== r && x[c] === data[c])) throw Object.assign(new Error(`unique ${c}`), { code: 'P2002' });
        }
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
      users: tabela(db.users, ['login', 'email', 'cpf']),
      funcionarios: tabela(db.func),
      sindicos: tabela(db.sindicos),
      sindicos_Condominios: tabela(db.sindCond),
      moradores: tabela(db.moradores),
      apartamentos_Users: tabela(db.aptUsers),
    };
    // Transação de verdade: qualquer erro desfaz tudo o que o callback gravou.
    prisma.$transaction = jest.fn(async (fn: any) => {
      const copia = JSON.parse(JSON.stringify(db));
      try {
        return await fn(prisma);
      } catch (e) {
        for (const k of Object.keys(db)) (db as any)[k].splice(0, (db as any)[k].length, ...copia[k]);
        throw e;
      }
    });
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
  const MSG_OUTRA_CONTA = 'Este e-mail já pertence a outra conta do sistema. Use outro e-mail para o acesso à portaria.';
  /** O que o loginFuncionario do app acharia com este e-mail: conta (login OU e-mail) e login de portaria idem. */
  const appAcha = (db: any, email: string) => ({
    conta: db.users.find((u: Linha) => u.login === email || u.email === email) ?? null,
    portaria: db.fp.find((f: Linha) => f.login === email || f.email === email) ?? null,
  });
  /** A conta não autentica mais: login/e-mail viraram lápide e a senha não é bcrypt nem md5 de nada. */
  const contaInutilizada = (u: Linha) => {
    expect(u.login).toMatch(/@conta-revogada\.invalid$/);
    expect(u.email).toBe(u.login);
    expect(u.password.startsWith('$2')).toBe(false);
    expect(u.password).not.toMatch(/^[0-9a-f]{32}$/);
    expect(u.senha_alterada_em).toBeInstanceOf(Date);
    expect(u.cpf ?? null).toBeNull();
  };
  const conta = (db: any, id: number) => db.users.find((u: Linha) => u.id === id);

  describe('I1 — trocar o e-mail de quem tem login desliga a conta antiga', () => {
    it('trocar o e-mail de quem tem login sem senha nova → 400 e nada é gravado', async () => {
      const { svc, db, prisma } = banco();
      for (const dto of [{ email: 'b@x.com' }, { email: 'b@x.com', hasPortariaAccess: true, senha: '' }]) {
        await expect(svc.update(1, dto as any, 1, sindico)).rejects.toThrow(
          new BadRequestException('Defina uma nova senha ao trocar o e-mail de acesso.'),
        );
      }
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
      expect(db.fp).toEqual([expect.objectContaining({ login: 'a@x.com', email: 'a@x.com' })]);
      expect(equipeAqui(db)).toHaveLength(1);
    });

    it('troca a@→b@ sem a chave e depois desliga a chave: nenhuma conta fica na equipe deste condomínio', async () => {
      const { svc, db } = banco();
      await svc.update(1, { email: 'b@x.com', senha: 'Nova#123' }, 1, sindico);
      // A conta antiga (só desta equipe) sai da equipe no mesmo ato e deixa de autenticar.
      expect(equipeAqui(db)).toHaveLength(0);
      contaInutilizada(conta(db, 5));
      // O login de portaria acompanha o e-mail novo — login E e-mail — com a senha nova.
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'b@x.com', email: 'b@x.com' })]);
      expect(await bcrypt.compare('Nova#123', db.fp[0].password)).toBe(true);
      // O app, com a@ e a senha antiga, não acha mais nem conta nem login de portaria: nada a recriar.
      expect(appAcha(db, 'a@x.com')).toEqual({ conta: null, portaria: null });

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
      expect(await bcrypt.compare('Nova#123', nova!.password)).toBe(true); // nunca a senha antiga
      expect(equipeAqui(db).map((f: Linha) => f.id_user)).toEqual([nova!.id]); // só a conta nova
      contaInutilizada(conta(db, 5));
      expect(appAcha(db, 'a@x.com')).toEqual({ conta: null, portaria: null });

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

    it('síndico com outro e-mail e senha nova: a conta antiga sai e o login (login e e-mail) acompanha com a senha nova', async () => {
      const { svc, db } = banco();
      await svc.create({ id_condominio: 1, nome: 'Eletricista', email: 'b@x.com', senha: 'Nova#123', hasPortariaAccess: false } as any, sindico);
      expect(db.prestadores[0].email).toBe('b@x.com');
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'b@x.com', email: 'b@x.com' })]);
      expect(await bcrypt.compare('Nova#123', db.fp[0].password)).toBe(true);
      expect(equipeAqui(db)).toHaveLength(0);
      contaInutilizada(conta(db, 5));
      expect(appAcha(db, 'a@x.com')).toEqual({ conta: null, portaria: null });
    });

    it('síndico com outro e-mail e sem senha nova → 400 e nada muda', async () => {
      const { svc, db, prisma } = banco();
      await expect(
        svc.create({ id_condominio: 1, nome: 'Eletricista', email: 'b@x.com', hasPortariaAccess: false } as any, sindico),
      ).rejects.toThrow(new BadRequestException('Defina uma nova senha ao trocar o e-mail de acesso.'));
      expect(prisma.prestadores_servico.update).not.toHaveBeenCalled();
      expect(db.fp).toEqual([expect.objectContaining({ login: 'a@x.com', email: 'a@x.com' })]);
      expect(equipeAqui(db)).toHaveLength(1);
    });
  });

  describe('I3 — religar a chave depois de revogar (rodada 2: prova de origem na revogação)', () => {
    it('conta só desta equipe: a revogação a inutiliza, e religar cria uma conta nova com a senha nova', async () => {
      const { svc, db } = banco();
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(equipeAqui(db)).toHaveLength(0);
      contaInutilizada(conta(db, 5));
      expect(db.users).toHaveLength(1); // nunca apaga Users

      await svc.update(1, { hasPortariaAccess: true, senha: 'Volta#123' }, 1, sindico);
      expect(db.fp).toEqual([expect.objectContaining({ login: 'a@x.com', email: 'a@x.com', turno: 'Geral', ativo: 1 })]);
      const nova = db.users.find((u: Linha) => u.login === 'a@x.com');
      expect(nova && nova.id).not.toBe(5);
      expect(await bcrypt.compare('Volta#123', nova!.password)).toBe(true);
      expect(equipeAqui(db).map((f: Linha) => f.id_user)).toEqual([nova!.id]);
      // A conta antiga continua sem autenticar.
      contaInutilizada(conta(db, 5));
    });

    it.each([
      ['também é morador', { moradores: [{ id: 1, id_user: 5, id_condominio: 2 }] }],
      ['é da equipe de outro condomínio', { func: [{ id: 78, id_user: 5, id_condominio: 2 }] }],
    ])('conta compartilhada (%s): e-mail e senha intactos após revogar; religar é recusado com a mensagem nova', async (_n, extra) => {
      const { svc, db } = banco(extra as any);
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(conta(db, 5)).toEqual(expect.objectContaining({ login: 'a@x.com', email: 'a@x.com', password: '$2b$04$antiga' }));
      expect(conta(db, 5).senha_alterada_em).toBeInstanceOf(Date);
      expect(equipeAqui(db)).toHaveLength(0);

      await expect(svc.update(1, { hasPortariaAccess: true, senha: 'Volta#123' }, 1, sindico)).rejects.toThrow(
        new BadRequestException(MSG_OUTRA_CONTA),
      );
      expect(conta(db, 5).password).toBe('$2b$04$antiga');
      expect(db.fp).toHaveLength(0);
      expect(equipeAqui(db)).toHaveLength(0);
    });

    it('conta órfã de outro condomínio (is_funcionario=1, sem vínculo): concessão em A recusada, senha intacta', async () => {
      const orfa = { id: 9, login: 'e@x.com', email: 'e@x.com', password: '$2b$04$daOrfa', is_funcionario: 1, is_sindico: 0, is_morador: 0, senha_alterada_em: null };
      const { svc, db } = banco({ users: [orfa] });
      await expect(
        svc.create({ id_condominio: 1, nome: 'Novo', email: 'e@x.com', hasPortariaAccess: true, senha: 'Minha#123' } as any, sindico),
      ).rejects.toThrow(new BadRequestException(MSG_OUTRA_CONTA));
      expect(conta(db, 9)).toEqual(expect.objectContaining({ password: '$2b$04$daOrfa', senha_alterada_em: null }));
      expect(db.func.filter((f: Linha) => f.id_user === 9)).toHaveLength(0);
      expect(db.fp.filter((f: Linha) => f.login === 'e@x.com')).toHaveLength(0);
      expect(db.prestadores).toHaveLength(1);
    });
  });

  it('M1 — e-mail do prestador igual ao `email` de outro login de portaria deste condomínio → 400', async () => {
    const { svc, db } = banco();
    db.fp.push({ id: 30, nome: 'Porteiro C', login: 'c-login', email: 'c@x.com', telefone: null, turno: 'Diurno', ativo: 1, id_condominio: 1, password: '$2b$04$colega' });
    await expect(svc.update(1, { email: 'c@x.com', senha: 'Nova#123' }, 1, sindico)).rejects.toThrow('Já existe um funcionário com este e-mail.');
    await expect(
      svc.create({ id_condominio: 1, nome: 'Outro', email: 'c@x.com', hasPortariaAccess: true, senha: 'Nova#123' } as any, sindico),
    ).rejects.toThrow('Já existe um funcionário com este e-mail.');
    await expect(svc.create({ id_condominio: 1, nome: 'Outro', email: 'c@x.com' } as any, porteiro)).rejects.toThrow(
      'Já existe um funcionário com este e-mail.',
    );
    expect(db.fp.find((f: Linha) => f.id === 30)!.password).toBe('$2b$04$colega');
  });

  describe('Rodada 3 — a revogação não pode ser bloqueada pela lápide', () => {
    afterEach(() => jest.restoreAllMocks());

    it('a lápide é aleatória: duas revogações da mesma conta não repetem o valor', () => {
      const { svc } = banco();
      const a = (svc as any).novaLapide(5);
      const b = (svc as any).novaLapide(5);
      expect(a).not.toBe(b);
      expect(a).toMatch(/^revogado-5-[0-9a-f]{32}@conta-revogada\.invalid$/);
      expect(a.length).toBeLessThanOrEqual(255);
    });

    it('lápide já ocupada (prestador se cadastrou com ela): a revogação conclui e a conta não autentica', async () => {
      const ocupada = 'revogado-5-ocupada@conta-revogada.invalid';
      const { svc, db } = banco({
        users: [{ id: 6, login: ocupada, email: ocupada, password: '$2b$04$dele', is_funcionario: 0, is_sindico: 0, is_morador: 0, senha_alterada_em: null }],
      });
      jest.spyOn(svc as any, 'novaLapide').mockReturnValue(ocupada);
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      // Vínculo e login de portaria saem, tokens caem e a senha é inutilizada — só o e-mail fica ocupado.
      expect(equipeAqui(db)).toHaveLength(0);
      expect(db.fp).toHaveLength(0);
      const c = conta(db, 5);
      expect(c.email).toBe('a@x.com');
      expect(c.password.startsWith('$2')).toBe(false);
      expect(c.senha_alterada_em).toBeInstanceOf(Date);
      expect(c.cpf).toBeNull();
      expect(appAcha(db, 'a@x.com').portaria).toBeNull();
      expect(db.users).toHaveLength(2);
    });

    it('colisão no @unique na hora de gravar (corrida): tenta outra lápide e conclui com ela', async () => {
      const { svc, db, prisma } = banco();
      const lapides = ['revogado-5-1@conta-revogada.invalid', 'revogado-5-2@conta-revogada.invalid'];
      jest.spyOn(svc as any, 'novaLapide').mockImplementation(() => lapides.shift());
      const updateOriginal = prisma.users.update.getMockImplementation();
      prisma.users.update.mockImplementationOnce(async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }); });
      prisma.users.update.mockImplementation(updateOriginal);
      await svc.update(1, { hasPortariaAccess: false }, 1, sindico);
      expect(conta(db, 5).login).toBe('revogado-5-2@conta-revogada.invalid');
      expect(db.fp).toHaveLength(0);
    });

    it('falha no meio da revogação: nada é apagado (transação)', async () => {
      const { svc, db, prisma } = banco();
      prisma.funcionarios_Portaria.deleteMany.mockRejectedValueOnce(new Error('banco caiu'));
      await expect(svc.update(1, { hasPortariaAccess: false }, 1, sindico)).rejects.toThrow(BadRequestException);
      expect(equipeAqui(db)).toHaveLength(1);
      expect(db.fp).toHaveLength(1);
      expect(conta(db, 5)).toEqual(expect.objectContaining({ login: 'a@x.com', email: 'a@x.com', password: '$2b$04$antiga', senha_alterada_em: null }));
      expect(db.prestadores[0].email).toBe('a@x.com');
    });

    it('e-mail do prestador no domínio das lápides → 400', async () => {
      const { svc } = banco();
      await expect(
        svc.create({ id_condominio: 1, nome: 'Novo', email: 'x@conta-revogada.invalid', hasPortariaAccess: true, senha: 'S#1234567' } as any, sindico),
      ).rejects.toThrow('E-mail inválido.');
      await expect(svc.update(1, { email: 'x@conta-revogada.invalid', senha: 'S#1234567' }, 1, sindico)).rejects.toThrow('E-mail inválido.');
    });
  });

  describe('Rodada 3 — re-credenciar com senha nova', () => {
    it('conta exclusivamente desta equipe: a senha do app vira a nova e os tokens caem', async () => {
      const { svc, db } = banco();
      await svc.update(1, { hasPortariaAccess: true, senha: 'Vazou#123' }, 1, sindico);
      expect(await bcrypt.compare('Vazou#123', db.fp[0].password)).toBe(true);
      expect(await bcrypt.compare('Vazou#123', conta(db, 5).password)).toBe(true);
      expect(conta(db, 5).senha_alterada_em).toBeInstanceOf(Date);
    });

    it.each([
      ['também é morador', { moradores: [{ id: 1, id_user: 5, id_condominio: 2 }] }],
      ['é da equipe de outro condomínio', { func: [{ id: 78, id_user: 5, id_condominio: 2 }] }],
    ])('conta compartilhada (%s): só o login de portaria muda; a conta não é tocada', async (_n, extra) => {
      const { svc, db } = banco(extra as any);
      await svc.update(1, { hasPortariaAccess: true, senha: 'Vazou#123' }, 1, sindico);
      expect(await bcrypt.compare('Vazou#123', db.fp[0].password)).toBe(true);
      expect(conta(db, 5)).toEqual(expect.objectContaining({ password: '$2b$04$antiga', senha_alterada_em: null }));
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
    contaInutilizada(conta(db, 5));
    expect(conta(db, 4)).toEqual(expect.objectContaining({ login: 'outro-login', email: 'a@x.com', password: 'x', senha_alterada_em: null }));
  });

  describe('Rodada 3 (raia s) — M8: turno do login mudado no app', () => {
    // O síndico cria o acesso no console (turno 'Geral') e muda o turno no app (saveFuncionario grava `turno`).
    const turnoMudado = (db: any) => { db.fp[0].turno = 'Manhã'; };

    it('editar o cadastro com a chave como está (o console reenvia hasPortariaAccess) não dá "Já existe um funcionário"', async () => {
      const { svc, db } = banco();
      turnoMudado(db);
      await svc.update(1, { nome: 'Eletricista', telefone: '(11) 7777', email: 'a@x.com', hasPortariaAccess: true, senha: '' }, 1, porteiro);
      expect(db.prestadores[0].telefone).toBe('(11) 7777');
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'a@x.com', turno: 'Manhã' })]);
    });

    it('desligar a chave revoga de fato (login, vínculo e conta)', async () => {
      const { svc, db } = banco();
      turnoMudado(db);
      await svc.update(1, { email: 'a@x.com', hasPortariaAccess: false }, 1, sindico);
      expect(db.fp).toHaveLength(0);
      expect(equipeAqui(db)).toHaveLength(0);
      contaInutilizada(conta(db, 5));
    });

    it('a lista mostra o login como próprio do cadastro, e remover exige síndico e revoga', async () => {
      const { svc, db } = banco();
      turnoMudado(db);
      const [p] = await svc.findAll(1, undefined, sindico);
      expect(p).toEqual(expect.objectContaining({ hasPortariaAccess: true, loginPortariaProprio: true }));
      await expect(svc.remove(1, 1, porteiro)).rejects.toThrow('exige síndico');
      await svc.remove(1, 1, sindico);
      expect(db.fp).toHaveLength(0);
      expect(equipeAqui(db)).toHaveLength(0);
    });

    it('linha de portaria com turno "Síndico" nunca é tratada como login do prestador', async () => {
      const { svc, db } = banco();
      db.fp[0].turno = 'Síndico';
      const [p] = await svc.findAll(1, undefined, sindico);
      expect(p.loginPortariaProprio).toBe(false);
      await svc.remove(1, 1, sindico);
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, turno: 'Síndico' })]);
      expect(equipeAqui(db)).toHaveLength(1);
    });
  });

  describe('Rodada 3 (raia s) — M-f1: troca de e-mail num ato só', () => {
    // Falha ao gravar o prestador logo depois de revogar a conta antiga: antes o login de portaria ficava com o
    // e-mail e a senha antigos (o dono do e-mail antigo seguia entrando no console) e o prestador sem a troca.
    it.each([
      ['sem a chave', { email: 'b@x.com', senha: 'Nova#123' }],
      ['com a chave', { email: 'b@x.com', hasPortariaAccess: true, senha: 'Nova#123' }],
    ])('%s: falha ao gravar o prestador desfaz tudo (conta, vínculo e login de portaria intactos)', async (_n, dto) => {
      const { svc, db, prisma } = banco();
      prisma.prestadores_servico.update.mockRejectedValueOnce(new Error('banco caiu'));
      await expect(svc.update(1, dto as any, 1, sindico)).rejects.toThrow(BadRequestException);
      expect(db.prestadores[0].email).toBe('a@x.com');
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'a@x.com', email: 'a@x.com', password: '$2b$04$doLogin' })]);
      expect(equipeAqui(db)).toHaveLength(1);
      expect(conta(db, 5)).toEqual(expect.objectContaining({ login: 'a@x.com', password: '$2b$04$antiga', senha_alterada_em: null }));
    });

    it('"Novo" do síndico com outro e-mail (upsert): falha ao gravar o prestador desfaz tudo', async () => {
      const { svc, db, prisma } = banco();
      prisma.prestadores_servico.update.mockRejectedValueOnce(new Error('banco caiu'));
      await expect(
        svc.create({ id_condominio: 1, nome: 'Eletricista', email: 'b@x.com', senha: 'Nova#123', hasPortariaAccess: false } as any, sindico),
      ).rejects.toThrow(BadRequestException);
      expect(db.prestadores[0].email).toBe('a@x.com');
      expect(db.fp).toEqual([expect.objectContaining({ id: 12, login: 'a@x.com', password: '$2b$04$doLogin' })]);
      expect(equipeAqui(db)).toHaveLength(1);
    });
  });

  describe('Rodada 3 (raia s) — Menor 4: permissões do vínculo de equipe na troca de e-mail com a chave', () => {
    it('a conta nova herda as permissões que o síndico tinha definido, em vez de todas ligadas', async () => {
      const flags = { areas_sociais: 1, comunicados: 0, ocorrencias: 1, manutencoes_programadas: 0, prestadores_servico: 1, agendar_mudanca: 0, cadastrar_visitante: 1, apartamentos: 0 };
      const { svc, db } = banco();
      Object.assign(db.func[0], flags, { funcao: 'Zelador', ch: 'Noite' });
      await svc.update(1, { email: 'b@x.com', hasPortariaAccess: true, senha: 'Nova#123' }, 1, sindico);
      const nova = db.users.find((u: Linha) => u.login === 'b@x.com')!;
      expect(equipeAqui(db)).toEqual([expect.objectContaining({ id_user: nova.id, ...flags, funcao: 'Zelador', ch: 'Noite' })]);
    });
  });
});
