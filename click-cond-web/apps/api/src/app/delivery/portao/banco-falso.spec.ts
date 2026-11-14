/*
 * Banco falso em memória para os testes do delivery e do autoatendimento no
 * portão (não é carregado em produção: arquivo .spec fica fora do build).
 *
 * Cobre o pedaço do Prisma que esses serviços usam: where com operadores
 * (in, notIn, not, lt/lte/gt/gte, OR/AND/NOT, filtro por relação e `some`),
 * select/include com relações, orderBy, take, count, e $transaction/$queryRaw
 * com GET_LOCK/RELEASE_LOCK de verdade (o segundo pedido espera o primeiro).
 */
type Row = Record<string, any>;
type Rel = { modelo: string; local: string; remoto: string; muitos: boolean };

const RELACOES: Record<string, Record<string, Rel>> = {
  deliveryAtendimentos: {
    apartamento: { modelo: 'apartamentos', local: 'id_apartamento', remoto: 'id', muitos: false },
    entregador: { modelo: 'deliveryEntregadores', local: 'id_entregador', remoto: 'id', muitos: false },
    condominio: { modelo: 'condominios', local: 'id_condominio', remoto: 'id', muitos: false },
    eventos: { modelo: 'deliveryEventos', local: 'id', remoto: 'id_atendimento', muitos: true },
    pedidosPortao: { modelo: 'deliveryPedidosPortao', local: 'id', remoto: 'id_atendimento', muitos: true },
  },
  deliveryPedidosPortao: {
    device: { modelo: 'facial_Devices', local: 'id_device', remoto: 'id', muitos: false },
    atendimento: { modelo: 'deliveryAtendimentos', local: 'id_atendimento', remoto: 'id', muitos: false },
  },
  apartamentos: {
    users: { modelo: 'apartamentos_Users', local: 'id', remoto: 'id_apto', muitos: true },
  },
  apartamentos_Users: {
    user: { modelo: 'users', local: 'id_user', remoto: 'id', muitos: false },
    apartamento: { modelo: 'apartamentos', local: 'id_apto', remoto: 'id', muitos: false },
  },
  facial_Devices: {
    condominio: { modelo: 'condominios', local: 'id_condominio', remoto: 'id', muitos: false },
  },
  deliveryEntregadores: {
    veiculos: { modelo: 'deliveryVeiculos', local: 'id', remoto: 'id_entregador', muitos: true },
  },
};

const PADROES: Record<string, (agora: Date) => Row> = {
  deliveryAtendimentos: (agora) => ({
    id_morador_user: null,
    id_entregador: null,
    estabelecimento: null,
    previsao_em: null,
    observacao_morador: null,
    nome_entregador: null,
    telefone_entregador: null,
    status: 'AGENDADA',
    modo_entrega: 'UNIDADE',
    origem: 'portaria',
    id_pedido_portao: null,
    chegou_em: null,
    autorizado_em: null,
    concluido_em: null,
    cancelado_em: null,
    recusado_em: null,
    motivo: null,
    created_at: agora,
    updated_at: agora,
  }),
  deliveryPedidosPortao: (agora) => ({
    plataforma: null,
    foto: null,
    status: 'pendente',
    visto_em: null,
    liberado_ate: null,
    aberto_em: null,
    saida_aberta_em: null,
    falha_abertura_em: null,
    criado_em: agora,
  }),
  deliveryEventos: (agora) => ({ created_at: agora }),
};

const valorComparavel = (v: any) => (v instanceof Date ? v.getTime() : v);

function igual(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a != null && b != null && valorComparavel(a) === valorComparavel(b);
  }
  return a === b;
}

export function criarBancoFalso(inicial: Record<string, Row[]> = {}, relogio: () => Date = () => new Date()) {
  const tabelas: Record<string, Row[]> = {};
  const seq: Record<string, number> = {};
  const tabela = (nome: string) => (tabelas[nome] ??= []);
  for (const [nome, rows] of Object.entries(inicial)) {
    tabelas[nome] = rows.map((r) => ({ ...r }));
    seq[nome] = rows.reduce((m, r) => Math.max(m, r.id ?? 0), 0);
  }

  function relacionados(modelo: string, row: Row, campo: string): Row[] | Row | null | undefined {
    const rel = RELACOES[modelo]?.[campo];
    if (!rel) return undefined;
    const alvo = tabela(rel.modelo).filter((r) => igual(r[rel.remoto], row[rel.local]));
    return rel.muitos ? alvo : (alvo[0] ?? null);
  }

  function casaCampo(valor: any, cond: any): boolean {
    if (cond === null) return valor === null || valor === undefined;
    if (cond instanceof Date || typeof cond !== 'object') return igual(valor, cond);
    return Object.entries(cond).every(([op, x]: [string, any]) => {
      const v = valorComparavel(valor);
      const y = valorComparavel(x);
      switch (op) {
        case 'equals':
          return casaCampo(valor, x);
        case 'in':
          return (x as any[]).some((i) => igual(valor, i));
        case 'notIn':
          return !(x as any[]).some((i) => igual(valor, i));
        case 'not':
          return !casaCampo(valor, x);
        case 'lt':
          return valor != null && v < y;
        case 'lte':
          return valor != null && v <= y;
        case 'gt':
          return valor != null && v > y;
        case 'gte':
          return valor != null && v >= y;
        case 'contains':
          return typeof valor === 'string' && valor.includes(x);
        default:
          throw new Error(`banco falso: operador ${op} não suportado`);
      }
    });
  }

  function casa(modelo: string, row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, c]) => {
      if (c === undefined) return true;
      if (k === 'OR') return (c as Row[]).some((w) => casa(modelo, row, w));
      if (k === 'AND') return (Array.isArray(c) ? c : [c]).every((w: Row) => casa(modelo, row, w));
      if (k === 'NOT') return !(Array.isArray(c) ? c : [c]).some((w: Row) => casa(modelo, row, w));
      const rel = RELACOES[modelo]?.[k];
      if (rel) {
        const r = relacionados(modelo, row, k);
        if (rel.muitos) {
          const lista = r as Row[];
          if (c.some) return lista.some((x) => casa(rel.modelo, x, c.some));
          if (c.none) return !lista.some((x) => casa(rel.modelo, x, c.none));
          if (c.every) return lista.every((x) => casa(rel.modelo, x, c.every));
          throw new Error('banco falso: filtro de lista sem some/none/every');
        }
        if (c === null) return r === null;
        return !!r && casa(rel.modelo, r as Row, c.is ?? c);
      }
      return casaCampo(row[k], c);
    });
  }

  function ordenar(rows: Row[], orderBy: any): Row[] {
    if (!orderBy) return rows;
    const regras = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o)) as [string, string][];
    return [...rows].sort((a, b) => {
      for (const [campo, dir] of regras) {
        const x = valorComparavel(a[campo]);
        const y = valorComparavel(b[campo]);
        if (x === y) continue;
        const r = x == null ? -1 : y == null ? 1 : x < y ? -1 : 1;
        return dir === 'desc' ? -r : r;
      }
      return 0;
    });
  }

  function projetar(modelo: string, row: Row, args: { select?: Row; include?: Row } = {}): Row {
    const montarRel = (campo: string, regra: any) => {
      const rel = RELACOES[modelo][campo];
      const r = relacionados(modelo, row, campo);
      const sub = regra === true ? {} : regra;
      if (rel.muitos) {
        let lista = (r as Row[]).filter((x) => casa(rel.modelo, x, sub.where));
        lista = ordenar(lista, sub.orderBy);
        if (sub.take !== undefined) lista = lista.slice(0, sub.take);
        return lista.map((x) => projetar(rel.modelo, x, sub));
      }
      return r ? projetar(rel.modelo, r as Row, sub) : null;
    };
    if (args.select) {
      const out: Row = {};
      for (const [campo, regra] of Object.entries(args.select)) {
        if (!regra) continue;
        out[campo] = RELACOES[modelo]?.[campo] ? montarRel(campo, regra) : row[campo];
      }
      return out;
    }
    const out: Row = { ...row };
    for (const [campo, regra] of Object.entries(args.include ?? {})) {
      if (regra) out[campo] = montarRel(campo, regra);
    }
    return out;
  }

  function delegado(modelo: string) {
    const achar = (args: any = {}) => {
      let rows = tabela(modelo).filter((r) => casa(modelo, r, args.where));
      rows = ordenar(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return rows;
    };
    return {
      findMany: jest.fn(async (args: any = {}) => achar(args).map((r) => projetar(modelo, r, args))),
      findFirst: jest.fn(async (args: any = {}) => {
        const r = achar(args)[0];
        return r ? projetar(modelo, r, args) : null;
      }),
      findUnique: jest.fn(async (args: any = {}) => {
        const r = achar(args)[0];
        return r ? projetar(modelo, r, args) : null;
      }),
      count: jest.fn(async (args: any = {}) => achar(args).length),
      create: jest.fn(async (args: any) => {
        const agora = relogio();
        const unicos = modelo === 'deliveryPedidosPortao' ? ['token_hash'] : [];
        for (const u of unicos) {
          if (tabela(modelo).some((r) => r[u] === args.data[u])) {
            throw Object.assign(new Error(`Unique constraint ${u}`), { code: 'P2002' });
          }
        }
        const row: Row = { ...(PADROES[modelo]?.(agora) ?? {}), ...args.data, id: (seq[modelo] = (seq[modelo] ?? 0) + 1) };
        tabela(modelo).push(row);
        return projetar(modelo, row, args);
      }),
      update: jest.fn(async (args: any) => {
        const r = achar({ where: args.where })[0];
        if (!r) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        Object.assign(r, args.data, 'updated_at' in r ? { updated_at: relogio() } : {});
        return projetar(modelo, r, args);
      }),
      updateMany: jest.fn(async (args: any) => {
        const rows = achar({ where: args.where });
        for (const r of rows) Object.assign(r, args.data, 'updated_at' in r ? { updated_at: relogio() } : {});
        return { count: rows.length };
      }),
      deleteMany: jest.fn(async (args: any = {}) => {
        const rows = achar({ where: args.where });
        tabelas[modelo] = tabela(modelo).filter((r) => !rows.includes(r));
        return { count: rows.length };
      }),
    };
  }

  // GET_LOCK com fila: o segundo espera o primeiro soltar (como o MySQL com espera > 0).
  const locks = new Map<string, Promise<void>>();
  const soltar = new Map<string, () => void>();
  const prisma: any = {
    isConnected: true,
    $queryRaw: jest.fn(async (partes: TemplateStringsArray, ...valores: any[]) => {
      const sql = partes.join('?');
      const nome = String(valores[0]);
      if (sql.includes('GET_LOCK')) {
        while (locks.has(nome)) await locks.get(nome);
        let liberar!: () => void;
        locks.set(nome, new Promise<void>((r) => (liberar = r)));
        soltar.set(nome, liberar);
        return [{ ok: 1 }];
      }
      if (sql.includes('RELEASE_LOCK')) {
        const l = soltar.get(nome);
        locks.delete(nome);
        soltar.delete(nome);
        l?.();
        return [{ ok: 1 }];
      }
      return [];
    }),
    $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  for (const modelo of [
    'deliveryAtendimentos',
    'deliveryEventos',
    'deliveryPedidosPortao',
    'deliveryEntregadores',
    'deliveryVeiculos',
    'apartamentos',
    'apartamentos_Users',
    'users',
    'facial_Devices',
    'condominios',
  ]) {
    prisma[modelo] = delegado(modelo);
  }
  return { prisma, tabelas, tabela };
}

describe('banco falso dos testes do portão', () => {
  it('filtra, ordena, projeta relações e trava como o GET_LOCK', async () => {
    const { prisma } = criarBancoFalso({
      apartamentos: [{ id: 1, id_condominio: 1, bloco: 'A', apto: '101' }],
      apartamentos_Users: [{ id: 1, id_apto: 1, id_user: 7 }],
      deliveryAtendimentos: [
        { id: 1, id_apartamento: 1, status: 'CHEGOU', created_at: new Date(1000) },
        { id: 2, id_apartamento: 1, status: 'CONCLUIDA', created_at: new Date(2000) },
      ],
    });
    const r = await prisma.deliveryAtendimentos.findMany({
      where: { status: { notIn: ['CONCLUIDA'] }, apartamento: { users: { some: { id_user: 7 } } } },
      include: { apartamento: { select: { bloco: true } } },
      orderBy: { created_at: 'desc' },
    });
    expect(r).toEqual([expect.objectContaining({ id: 1, apartamento: { bloco: 'A' } })]);

    const ordem: string[] = [];
    const tarefa = (n: string) =>
      prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT GET_LOCK(${'x'}, ${5}) AS ok`;
        ordem.push(`${n}:entra`);
        await new Promise((res) => setImmediate(res));
        ordem.push(`${n}:sai`);
        await tx.$queryRaw`SELECT RELEASE_LOCK(${'x'}) AS ok`;
      });
    await Promise.all([tarefa('a'), tarefa('b')]);
    expect(ordem).toEqual(['a:entra', 'a:sai', 'b:entra', 'b:sai']);
  });
});
