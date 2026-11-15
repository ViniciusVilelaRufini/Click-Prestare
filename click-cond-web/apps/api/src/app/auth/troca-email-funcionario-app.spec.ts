import * as bcrypt from 'bcrypt';
import { MobileAuthService } from './mobile-auth.service';
import { TenantAccessService } from './tenant-access.service';
import { limparCacheLoginPortariaDesativado } from './login-portaria-desativado.util';

/**
 * Rodada 4 (raia e), correção I-a — o síndico troca no app o e-mail (= login) de um porteiro (saveFuncionario,
 * edição). O login de portaria ia para o e-mail novo e a sincronização criava a conta do e-mail novo, mas a conta
 * ANTIGA (login antigo, mesma senha) seguia com o vínculo Funcionarios deste condomínio: entrava no app, fora do
 * alcance da aba "Equipe da portaria" (desativar a linha nova não a alcançava). Agora vale a regra do cadastro de
 * prestador no console: no mesmo ato, a conta antiga sai da equipe daqui e perde os tokens; vira lápide só se era
 * exclusivamente desta equipe. Edição sem trocar o e-mail não revoga nada. O app 1.2.48 manda id, nome, email,
 * telefone, ch, senha (pode ir vazia) e photo.
 */
describe('saveFuncionario (app) — trocar o e-mail do porteiro tira a conta antiga deste condomínio', () => {
  type Linha = Record<string, any>;
  const sindico = { sub: 51, nome: 'Síndico', typeAccess: 'Sindico', user: { id: 51 } } as any;
  const hash = bcrypt.hashSync('Senha#123', 4);

  function banco(extra: { morador?: boolean } = {}) {
    const db = {
      fp: [{ id: 12, nome: 'Ana', login: 'ana@x.com', email: 'ana@x.com', telefone: '1', turno: 'Diurno', ativo: 1, id_condominio: 1, password: hash }] as Linha[],
      users: [
        { id: 5, login: 'ana@x.com', email: 'ana@x.com', password: hash, cpf: '1', is_funcionario: 1, is_sindico: 0, is_morador: 0, senha_alterada_em: null, photo: null },
        { id: 51, login: 'sind@x.com', email: 'sind@x.com', password: 'h', is_sindico: 1, is_morador: 0, is_funcionario: 0, senha_alterada_em: null },
      ] as Linha[],
      func: [
        { id: 70, id_user: 5, id_condominio: 1, nome: 'Ana', funcao: 'Porteira', ch: 'Diurno', areas_sociais: 1, comunicados: 0, ocorrencias: 1, manutencoes_programadas: 0, prestadores_servico: 1, agendar_mudanca: 0, cadastrar_visitante: 1, apartamentos: 0 },
      ] as Linha[],
      sindicos: [{ id: 1, id_user: 51 }] as Linha[],
      sindCond: [{ id: 1, id_user: 51, id_condominio: 1 }] as Linha[],
      moradores: (extra.morador ? [{ id: 9, id_user: 5, id_condominio: 1 }] : []) as Linha[],
      aptUsers: [] as Linha[],
      prestadores: [] as Linha[],
    };
    let seq = 1000;
    const casa = (row: Linha, where: Linha = {}): boolean =>
      Object.entries(where).every(([k, v]) => {
        if (k === 'OR') return (v as Linha[]).some((w) => casa(row, w));
        if (k === 'NOT') return !casa(row, v);
        if (k === 'condominio') return true;
        if (k === 'apartamento') return casa(row, v);
        if (k === 'funcionarios') return db.func.some((f) => f.id_user === row.id && casa(f, v.some));
        if (v && typeof v === 'object' && 'not' in v) return row[k] !== v.not;
        if (v && typeof v === 'object' && 'in' in v) return v.in.includes(row[k]);
        // Como a collation do MySQL: texto sem diferenciar caixa.
        if (typeof v === 'string' && typeof row[k] === 'string') return row[k].toLowerCase() === v.toLowerCase();
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
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = rows.filter((x) => casa(x, where));
        alvo.forEach((x) => Object.assign(x, data));
        return { count: alvo.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const fica = rows.filter((x) => !casa(x, where));
        const n = rows.length - fica.length;
        rows.splice(0, rows.length, ...fica);
        return { count: n };
      }),
    });
    const prisma: any = {
      isConnected: true,
      funcionarios_Portaria: tabela(db.fp),
      users: tabela(db.users),
      funcionarios: tabela(db.func),
      sindicos: tabela(db.sindicos),
      sindicos_Condominios: tabela(db.sindCond),
      moradores: tabela(db.moradores),
      apartamentos_Users: tabela(db.aptUsers),
      prestadores_servico: tabela(db.prestadores),
      $queryRaw: jest.fn(async (_s: TemplateStringsArray, idUser: number, idCond: number) => {
        const u = db.users.find((x) => x.id === idUser);
        if (!u) return [];
        const chaves = [u.login, u.email].filter(Boolean);
        return db.fp.filter((f) => f.id_condominio === idCond && (chaves.includes(f.login) || chaves.includes(f.email))).map((f) => ({ ativo: f.ativo }));
      }),
    };
    prisma.$transaction = jest.fn(async (fn: any) => {
      const copia = JSON.parse(JSON.stringify(db));
      try {
        return await fn(prisma);
      } catch (e) {
        for (const k of Object.keys(db)) (db as any)[k].splice(0, (db as any)[k].length, ...copia[k]);
        throw e;
      }
    });
    const tenant: any = { assertEntidade: jest.fn(async () => undefined), assertCondominio: jest.fn(async () => undefined) };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn(), exigirArquivoDoRegistro: jest.fn(async () => undefined) };
    const svc = new MobileAuthService(prisma, { sign: jest.fn(() => 't') } as any, {} as any, storage, {} as any, tenant);
    return { svc, db, prisma };
  }

  beforeEach(() => limparCacheLoginPortariaDesativado());

  /** O payload exato do app 1.2.48 (new_funcionario_1.dart → FuncionarioModel.toJson), senha vazia. */
  const doApp = (over: Linha) => ({
    id_condominio: 1,
    funcionario: { id: 12, nome: 'Ana', documento: '', email: 'ana@x.com', telefone: '1', funcao: 'Porteira', ch: 'Diurno', senha: '', photo: null, permissoes: [], extra1: '', extra2: '', hasPortariaAccess: true, ...over },
  });
  const equipeAqui = (db: any) => db.func.filter((f: Linha) => f.id_condominio === 1);

  it('edição comum (nome, telefone, turno) sem trocar o e-mail: nada é revogado', async () => {
    const { svc, db } = banco();
    await svc.saveFuncionario(doApp({ nome: 'Ana Souza', telefone: '2', ch: 'Noturno' }), true, sindico);
    expect(db.fp[0]).toEqual(expect.objectContaining({ login: 'ana@x.com', nome: 'Ana Souza', turno: 'Noturno' }));
    expect(equipeAqui(db).map((f: Linha) => f.id_user)).toEqual([5]);
    expect(db.users.find((u) => u.id === 5)).toEqual(expect.objectContaining({ login: 'ana@x.com', senha_alterada_em: null, password: hash }));
  });

  it('só a caixa do e-mail muda: não é troca', async () => {
    const { svc, db } = banco();
    await svc.saveFuncionario(doApp({ email: 'Ana@X.com' }), true, sindico);
    expect(equipeAqui(db).map((f: Linha) => f.id_user)).toEqual([5]);
  });

  it('troca de e-mail (sem senha nova, como o app manda): a conta antiga sai daqui e vira lápide; a nova herda as permissões', async () => {
    const { svc, db } = banco();
    await svc.saveFuncionario(doApp({ email: 'ana.nova@x.com' }), true, sindico);
    expect(db.fp[0]).toEqual(expect.objectContaining({ login: 'ana.nova@x.com', email: 'ana.nova@x.com' }));
    const antiga = db.users.find((u) => u.id === 5)!;
    expect(antiga.login).toMatch(/@conta-revogada\.invalid$/);
    expect(antiga.password.startsWith('$2')).toBe(false);
    expect(antiga.senha_alterada_em).toBeInstanceOf(Date);
    expect(db.users).toHaveLength(3); // nunca apaga Users: a antiga fica, a nova nasce
    const nova = db.users.find((u) => u.login === 'ana.nova@x.com')!;
    expect(equipeAqui(db)).toEqual([
      expect.objectContaining({ id_user: nova.id, funcao: 'Porteira', comunicados: 0, manutencoes_programadas: 0, apartamentos: 0, ocorrencias: 1 }),
    ]);
  });

  it('conta antiga compartilhada (também moradora): perde só o vínculo daqui e os tokens; e-mail e senha intactos', async () => {
    const { svc, db } = banco({ morador: true });
    await svc.saveFuncionario(doApp({ email: 'ana.nova@x.com' }), true, sindico);
    const antiga = db.users.find((u) => u.id === 5)!;
    expect(antiga).toEqual(expect.objectContaining({ login: 'ana@x.com', email: 'ana@x.com', password: hash }));
    expect(antiga.senha_alterada_em).toBeInstanceOf(Date);
    expect(equipeAqui(db).some((f: Linha) => f.id_user === 5)).toBe(false);
  });

  it('depois da troca, desativar a linha nova corta o acesso da pessoa (conta nova) e a antiga não tem mais nada aqui', async () => {
    const { svc, db, prisma } = banco({ morador: true });
    await svc.saveFuncionario(doApp({ email: 'ana.nova@x.com' }), true, sindico);
    const nova = db.users.find((u) => u.login === 'ana.nova@x.com')!;
    const tenant = new TenantAccessService(prisma);
    const comoFuncionario = (id: number) => ({ sub: id, nome: 'Ana', typeAccess: 'Funcionario', user: { id } }) as any;
    await expect(tenant.assertCondominio(1, comoFuncionario(nova.id))).resolves.toBeUndefined();
    await expect(tenant.assertCondominio(1, comoFuncionario(5))).rejects.toThrow('você não trabalha neste condomínio');

    await svc.alterarLoginPortaria(1, 12, { ativo: false }, { ...sindico, id_condominio: 1 });
    await expect(tenant.assertCondominio(1, comoFuncionario(nova.id))).rejects.toThrow('está desativado');
  });

  it('falha no meio da troca: nada muda (transação)', async () => {
    const { svc, db, prisma } = banco();
    prisma.funcionarios_Portaria.update.mockRejectedValueOnce(new Error('banco caiu'));
    await expect(svc.saveFuncionario(doApp({ email: 'ana.nova@x.com' }), true, sindico)).rejects.toThrow(
      'Não foi possível trocar o e-mail do funcionário. Tente novamente.',
    );
    expect(db.fp[0].login).toBe('ana@x.com');
    expect(db.users.find((u) => u.id === 5)).toEqual(expect.objectContaining({ login: 'ana@x.com', senha_alterada_em: null }));
    expect(equipeAqui(db).map((f: Linha) => f.id_user)).toEqual([5]);
  });
});
