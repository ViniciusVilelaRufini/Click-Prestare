/*
 * Banco falso em memória para os testes do interfone (arquivo .spec: fica fora
 * do build). Cobre o pedaço do Prisma que os serviços do interfone usam: where
 * com operadores (in, notIn, not, lt/lte/gt/gte, OR/AND, filtro por relação e
 * `some`), select/include com relações, orderBy, take, count, create, update,
 * updateMany, delete e deleteMany.
 */
type Row = Record<string, any>;
type Rel = { modelo: string; local: string; remoto: string; muitos: boolean };

const RELACOES: Record<string, Record<string, Rel>> = {
  apartamentos: {
    condominio: { modelo: 'condominios', local: 'id_condominio', remoto: 'id', muitos: false },
    users: { modelo: 'apartamentos_Users', local: 'id', remoto: 'id_apto', muitos: true },
  },
  apartamentos_Users: {
    apartamento: { modelo: 'apartamentos', local: 'id_apto', remoto: 'id', muitos: false },
    user: { modelo: 'users', local: 'id_user', remoto: 'id', muitos: false },
  },
  users: {
    apartamentosUsers: { modelo: 'apartamentos_Users', local: 'id', remoto: 'id_user', muitos: true },
  },
  facial_Devices: {
    condominio: { modelo: 'condominios', local: 'id_condominio', remoto: 'id', muitos: false },
  },
  interfone_Monitores: {
    condominio: { modelo: 'condominios', local: 'id_condominio', remoto: 'id', muitos: false },
    apartamento: { modelo: 'apartamentos', local: 'id_apartamento', remoto: 'id', muitos: false },
  },
  interfone_Chamadas: {
    condominio: { modelo: 'condominios', local: 'id_condominio', remoto: 'id', muitos: false },
    apartamento: { modelo: 'apartamentos', local: 'id_apartamento', remoto: 'id', muitos: false },
    facial: { modelo: 'facial_Devices', local: 'id_facial', remoto: 'id', muitos: false },
  },
};

const PADROES: Record<string, Row> = {
  interfone_Chamadas: {
    resultado: null,
    id_facial: null,
    id_apartamento: null,
    numero_discado: null,
    id_user_origem: null,
    id_porteiro_origem: null,
    motivo_portaria: null,
    atendida_em: null,
    atendida_por_tipo: null,
    atendida_por_id: null,
    atendida_por_nome: null,
    encerrada_em: null,
    duracao_s: null,
    foto: null,
    porta_aberta_em: null,
    porta_aberta_por_nome: null,
    porta_aberta_como: null,
    recusas: null,
    tocou_ids: null,
  },
  interfone_Monitores: { ativo: 1 },
};

const MODELOS = [
  'condominios',
  'apartamentos',
  'apartamentos_Users',
  'users',
  'users_Devices',
  'facial_Devices',
  'funcionarios_Portaria',
  'interfone_Monitores',
  'interfone_Chamadas',
];

const ehOperador = (v: any) =>
  v !== null &&
  typeof v === 'object' &&
  !(v instanceof Date) &&
  Object.keys(v).some((k) => ['in', 'notIn', 'not', 'lt', 'lte', 'gt', 'gte', 'equals'].includes(k));

function comparar(a: any, b: any): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

function igual(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) return a != null && b != null && comparar(a, b) === 0;
  return a === b;
}

export function criarBancoFalso(inicial: Partial<Record<string, Row[]>> = {}) {
  const tabelas: Record<string, Row[]> = {};
  const seq: Record<string, number> = {};
  for (const m of MODELOS) {
    tabelas[m] = (inicial[m] ?? []).map((r) => ({ ...(PADROES[m] ?? {}), ...r }));
    seq[m] = tabelas[m].reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 0);
  }

  function relacionados(modelo: string, linha: Row, nome: string): Row[] | Row | null {
    const rel = RELACOES[modelo]?.[nome];
    if (!rel) throw new Error(`banco falso: relação ${modelo}.${nome} desconhecida`);
    const alvo = tabelas[rel.modelo].filter((r) => igual(r[rel.remoto], linha[rel.local]));
    return rel.muitos ? alvo : (alvo[0] ?? null);
  }

  function casaCampo(valor: any, cond: any): boolean {
    if (!ehOperador(cond)) return cond === null ? valor === null || valor === undefined : igual(valor, cond);
    for (const [op, v] of Object.entries(cond)) {
      if (op === 'equals' && !igual(valor, v)) return false;
      if (op === 'in' && !(v as any[]).some((x) => igual(valor, x))) return false;
      if (op === 'notIn' && (v as any[]).some((x) => igual(valor, x))) return false;
      if (op === 'not') {
        if (v === null ? valor === null || valor === undefined : ehOperador(v) ? casaCampo(valor, v) : igual(valor, v)) return false;
      }
      if (['lt', 'lte', 'gt', 'gte'].includes(op)) {
        if (valor === null || valor === undefined) return false;
        const c = comparar(valor, v);
        if (op === 'lt' && !(c < 0)) return false;
        if (op === 'lte' && !(c <= 0)) return false;
        if (op === 'gt' && !(c > 0)) return false;
        if (op === 'gte' && !(c >= 0)) return false;
      }
    }
    return true;
  }

  function casa(modelo: string, linha: Row, where: Row | undefined): boolean {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (k === 'OR') {
        if (!(cond as Row[]).some((w) => casa(modelo, linha, w))) return false;
        continue;
      }
      if (k === 'AND') {
        if (!(cond as Row[]).every((w) => casa(modelo, linha, w))) return false;
        continue;
      }
      const rel = RELACOES[modelo]?.[k];
      if (rel) {
        const r = relacionados(modelo, linha, k);
        if (rel.muitos) {
          const lista = r as Row[];
          if (cond.some && !lista.some((x) => casa(rel.modelo, x, cond.some))) return false;
          if (cond.none && lista.some((x) => casa(rel.modelo, x, cond.none))) return false;
        } else if (cond === null) {
          if (r !== null) return false;
        } else if (!r || !casa(rel.modelo, r as Row, cond)) {
          return false;
        }
        continue;
      }
      if (!casaCampo(linha[k], cond)) return false;
    }
    return true;
  }

  function projetar(modelo: string, linha: Row, args: { select?: Row; include?: Row } = {}): Row {
    if (args.select) {
      const out: Row = {};
      for (const [k, v] of Object.entries(args.select)) {
        if (!v) continue;
        if (RELACOES[modelo]?.[k]) out[k] = projetarRel(modelo, linha, k, v);
        else out[k] = linha[k];
      }
      return out;
    }
    const out: Row = { ...linha };
    for (const [k, v] of Object.entries(args.include ?? {})) {
      if (v) out[k] = projetarRel(modelo, linha, k, v);
    }
    return out;
  }

  function projetarRel(modelo: string, linha: Row, nome: string, v: any) {
    const rel = RELACOES[modelo][nome];
    const r = relacionados(modelo, linha, nome);
    const sub = v === true ? {} : v;
    if (rel.muitos) return (r as Row[]).filter((x) => casa(rel.modelo, x, sub.where)).map((x) => projetar(rel.modelo, x, sub));
    return r ? projetar(rel.modelo, r as Row, sub) : null;
  }

  function ordenar(lista: Row[], orderBy: any): Row[] {
    if (!orderBy) return lista;
    const regras = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: Row) => Object.entries(o));
    return [...lista].sort((a, b) => {
      for (const [k, dir] of regras) {
        const c = comparar(a[k], b[k]);
        if (c !== 0) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }

  function delegado(modelo: string) {
    const t = () => tabelas[modelo];
    const achar = (where: Row) => t().filter((r) => casa(modelo, r, where));
    return {
      findMany: jest.fn(async (a: any = {}) => {
        let l = ordenar(achar(a.where), a.orderBy);
        if (a.skip) l = l.slice(a.skip);
        if (a.take !== undefined) l = l.slice(0, a.take);
        return l.map((r) => projetar(modelo, r, a));
      }),
      findFirst: jest.fn(async (a: any = {}) => {
        const r = ordenar(achar(a.where), a.orderBy)[0];
        return r ? projetar(modelo, r, a) : null;
      }),
      findUnique: jest.fn(async (a: any = {}) => {
        const r = achar(a.where)[0];
        return r ? projetar(modelo, r, a) : null;
      }),
      count: jest.fn(async (a: any = {}) => achar(a.where).length),
      create: jest.fn(async (a: any) => {
        const linha: Row = { ...(PADROES[modelo] ?? {}), created_at: new Date(), ...a.data };
        if (linha.id === undefined) linha.id = ++seq[modelo];
        t().push(linha);
        return projetar(modelo, linha, a);
      }),
      update: jest.fn(async (a: any) => {
        const r = achar(a.where)[0];
        if (!r) throw Object.assign(new Error('Registro não encontrado'), { code: 'P2025' });
        Object.assign(r, a.data);
        return projetar(modelo, r, a);
      }),
      updateMany: jest.fn(async (a: any) => {
        const l = achar(a.where);
        l.forEach((r) => Object.assign(r, a.data));
        return { count: l.length };
      }),
      delete: jest.fn(async (a: any) => {
        const r = achar(a.where)[0];
        if (!r) throw Object.assign(new Error('Registro não encontrado'), { code: 'P2025' });
        tabelas[modelo] = t().filter((x) => x !== r);
        return r;
      }),
      deleteMany: jest.fn(async (a: any = {}) => {
        const l = achar(a.where);
        tabelas[modelo] = t().filter((x) => !l.includes(x));
        return { count: l.length };
      }),
    };
  }

  const prisma: any = { isConnected: true };
  for (const m of MODELOS) prisma[m] = delegado(m);
  prisma.$transaction = jest.fn(async (arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  return { prisma, tabelas };
}

describe('banco falso do interfone', () => {
  it('filtra por relação e some, projeta relações, ordena e conta', async () => {
    const { prisma } = criarBancoFalso({
      condominios: [{ id: 1, nome: 'C' }],
      apartamentos: [{ id: 10, id_condominio: 1, apto: '1', bloco: 'A' }],
      users: [{ id: 7 }, { id: 8 }],
      apartamentos_Users: [
        { id: 1, id_apto: 10, id_user: 7, vencimento: null },
        { id: 2, id_apto: 10, id_user: 8, vencimento: new Date(0) },
      ],
    });
    const us = await prisma.users.findMany({
      where: { apartamentosUsers: { some: { id_apto: 10, OR: [{ vencimento: null }, { vencimento: { gte: new Date(1) } }] } } },
      select: { id: true },
    });
    expect(us).toEqual([{ id: 7 }]);
    const a = await prisma.apartamentos_Users.findFirst({ where: { id_user: 8 }, include: { apartamento: { select: { condominio: true } } } });
    expect(a.apartamento.condominio.nome).toBe('C');
    expect(await prisma.apartamentos_Users.count({ where: { id_user: { in: [7, 8] } } })).toBe(2);
    const o = await prisma.users.findMany({ orderBy: { id: 'desc' }, take: 1 });
    expect(o[0].id).toBe(8);
  });
});
