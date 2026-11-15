/**
 * Banco falso em memória para os testes do Módulo Guarita: o suficiente do
 * cliente Prisma para exercitar a fila, a deduplicação e as duas instâncias
 * (dois serviços sobre o MESMO objeto) — inclusive os índices únicos, que são
 * a defesa contra corrida entre instâncias.
 *
 * Não é um ORM: entende só os filtros que o módulo usa (igualdade, null, in,
 * notIn, not, gt/gte/lt/lte, contains, startsWith, OR/AND/NOT) e nenhum filtro
 * por relação (o módulo não usa: as consultas são em dois passos, tipadas).
 */

type Linha = Record<string, any>;

interface DefTabela {
  /** Chave primária (padrão 'id', autoincremento). */
  pk?: string;
  /** Índices únicos (cada um é uma lista de colunas). */
  unicos?: string[][];
  /** Valores padrão das colunas. */
  padroes?: Record<string, () => any>;
}

const TABELAS: Record<string, DefTabela> = {
  facial_Devices: { padroes: { ativo: () => 1, tipo: () => 'facial', created_at: () => new Date() } },
  condominios: {},
  tags: {
    unicos: [['id_condominio', 'codigo']],
    padroes: { ativo: () => 1, tipo: () => 'rfid', created_at: () => new Date(), updated_at: () => new Date() },
  },
  veiculos: { unicos: [['id_condominio', 'placa']], padroes: { ativo: () => 1, created_at: () => new Date() } },
  moradores: {},
  apartamentos: {},
  apartamentos_Users: {},
  acessos_Facial: { padroes: { created_at: () => new Date() } },
  guarita_Operacoes: { padroes: { estado: () => 'pendente', created_at: () => new Date() } },
  guarita_Eventos: { unicos: [['id_device', 'chave']], padroes: { created_at: () => new Date() } },
  guarita_Backups: { padroes: { created_at: () => new Date() } },
  guarita_Portoes: { padroes: { created_at: () => new Date(), updated_at: () => new Date() } },
  guarita_Alertas: { padroes: { created_at: () => new Date() } },
  guarita_Importacoes: { unicos: [['id_operacao', 'parte']], padroes: { fim: () => 0 } },
  estado_Compartilhado: { pk: 'chave', padroes: { criado_em: () => new Date() } },
  auditLog: { padroes: { created_at: () => new Date() } },
};

function erroUnico(campos: string[]) {
  const e: any = new Error(`Unique constraint failed on the fields: (${campos.join(',')})`);
  e.code = 'P2002';
  e.meta = { target: campos };
  return e;
}

function erroNaoEncontrado() {
  const e: any = new Error('Record to update not found.');
  e.code = 'P2025';
  return e;
}

function valor(v: any) {
  return v instanceof Date ? v.getTime() : v;
}

function casaCampo(atual: any, filtro: any): boolean {
  if (filtro === undefined) return true;
  if (filtro === null) return atual === null || atual === undefined;
  if (filtro instanceof Date) return valor(atual) === filtro.getTime();
  if (typeof filtro !== 'object') return atual === filtro;
  for (const [op, alvo] of Object.entries(filtro)) {
    switch (op) {
      case 'equals':
        if (!casaCampo(atual, alvo)) return false;
        break;
      case 'in':
        if (!(alvo as any[]).some((x) => valor(x) === valor(atual))) return false;
        break;
      case 'notIn':
        if ((alvo as any[]).some((x) => valor(x) === valor(atual))) return false;
        break;
      case 'not':
        if (casaCampo(atual, alvo)) return false;
        break;
      case 'gt':
        if (atual == null || !(valor(atual) > valor(alvo))) return false;
        break;
      case 'gte':
        if (atual == null || !(valor(atual) >= valor(alvo))) return false;
        break;
      case 'lt':
        if (atual == null || !(valor(atual) < valor(alvo))) return false;
        break;
      case 'lte':
        if (atual == null || !(valor(atual) <= valor(alvo))) return false;
        break;
      case 'contains':
        if (typeof atual !== 'string' || !atual.includes(alvo as string)) return false;
        break;
      case 'startsWith':
        if (typeof atual !== 'string' || !atual.startsWith(alvo as string)) return false;
        break;
      case 'mode':
        break;
      default:
        throw new Error(`banco falso: operador não suportado "${op}"`);
    }
  }
  return true;
}

function casa(linha: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, f] of Object.entries(where)) {
    if (f === undefined) continue;
    if (k === 'OR') {
      if (!(f as any[]).some((w) => casa(linha, w))) return false;
      continue;
    }
    if (k === 'AND') {
      const lista = Array.isArray(f) ? f : [f];
      if (!lista.every((w) => casa(linha, w))) return false;
      continue;
    }
    if (k === 'NOT') {
      const lista = Array.isArray(f) ? f : [f];
      if (lista.some((w) => casa(linha, w))) return false;
      continue;
    }
    // Chave composta (findUnique / upsert): { id_device_chave: { id_device, chave } }
    if (!(k in linha) && f && typeof f === 'object' && !(f instanceof Date) && !Object.keys(f).some((o) => o in OPERADORES)) {
      if (!casa(linha, f)) return false;
      continue;
    }
    if (!casaCampo(linha[k], f)) return false;
  }
  return true;
}

const OPERADORES: Record<string, true> = {
  equals: true, in: true, notIn: true, not: true, gt: true, gte: true, lt: true, lte: true,
  contains: true, startsWith: true, mode: true,
};

function copia<T>(x: T): T {
  if (x === null || x === undefined) return x;
  if (x instanceof Date) return new Date(x.getTime()) as any;
  if (Array.isArray(x)) return x.map(copia) as any;
  if (typeof x === 'object') {
    const o: any = {};
    for (const [k, v] of Object.entries(x as any)) o[k] = copia(v);
    return o;
  }
  return x;
}

function projetar(linha: Linha, select?: Record<string, any>): Linha {
  if (!select) return copia(linha);
  const o: Linha = {};
  for (const [k, v] of Object.entries(select)) if (v) o[k] = copia(linha[k]);
  return o;
}

function ordenar(linhas: Linha[], orderBy: any): Linha[] {
  if (!orderBy) return linhas;
  const regras: Array<[string, 'asc' | 'desc']> = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: any) =>
    Object.entries(o) as Array<[string, 'asc' | 'desc']>,
  );
  return [...linhas].sort((a, b) => {
    for (const [campo, dir] of regras) {
      const va = valor(a[campo]);
      const vb = valor(b[campo]);
      if (va === vb) continue;
      if (va == null) return dir === 'asc' ? -1 : 1;
      if (vb == null) return dir === 'asc' ? 1 : -1;
      return (va < vb ? -1 : 1) * (dir === 'asc' ? 1 : -1);
    }
    return 0;
  });
}

function aplicarDados(linha: Linha, data: Linha) {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !(v instanceof Date) && 'increment' in v) {
      linha[k] = (linha[k] ?? 0) + (v as any).increment;
    } else {
      linha[k] = copia(v);
    }
  }
}

export interface BancoFalso {
  [tabela: string]: any;
  isConnected: boolean;
  $transaction: (arg: any) => Promise<any>;
  /** Linhas cruas (para conferir no teste). */
  linhas: (tabela: string) => Linha[];
  /** Insere linhas direto (fixture), respeitando padrões e ids. */
  semear: (tabela: string, linhas: Linha[]) => Linha[];
}

export function criarBancoFalso(): BancoFalso {
  const dados: Record<string, Linha[]> = {};
  const seq: Record<string, number> = {};

  function delegado(nome: string) {
    const def = TABELAS[nome] ?? {};
    const pk = def.pk ?? 'id';
    dados[nome] = dados[nome] ?? [];
    seq[nome] = seq[nome] ?? 0;
    const linhas = () => dados[nome];

    function conferirUnicos(candidata: Linha, ignorar?: Linha) {
      const unicos = [...(def.unicos ?? []), [pk]];
      for (const campos of unicos) {
        if (campos.some((c) => candidata[c] === null || candidata[c] === undefined)) continue;
        const choque = linhas().find(
          (l) => l !== ignorar && campos.every((c) => valor(l[c]) === valor(candidata[c])),
        );
        if (choque) throw erroUnico(campos);
      }
    }

    function inserir(data: Linha): Linha {
      const nova: Linha = {};
      for (const [c, f] of Object.entries(def.padroes ?? {})) nova[c] = f();
      aplicarDados(nova, data);
      if (pk === 'id' && (nova.id === undefined || nova.id === null)) nova.id = ++seq[nome];
      else if (pk === 'id' && nova.id > seq[nome]) seq[nome] = nova.id;
      conferirUnicos(nova);
      linhas().push(nova);
      return nova;
    }

    const api = {
      findMany: async (args: any = {}) => {
        let r = linhas().filter((l) => casa(l, args.where));
        r = ordenar(r, args.orderBy);
        if (args.skip) r = r.slice(args.skip);
        if (args.take !== undefined) r = r.slice(0, args.take);
        return r.map((l) => projetar(l, args.select));
      },
      findFirst: async (args: any = {}) => {
        const r = ordenar(linhas().filter((l) => casa(l, args.where)), args.orderBy);
        return r[0] ? projetar(r[0], args.select) : null;
      },
      findUnique: async (args: any = {}) => {
        const r = linhas().find((l) => casa(l, args.where));
        return r ? projetar(r, args.select) : null;
      },
      count: async (args: any = {}) => linhas().filter((l) => casa(l, args.where)).length,
      create: async (args: any) => projetar(inserir(args.data), args.select),
      createMany: async (args: any) => {
        let count = 0;
        for (const d of args.data) {
          try {
            inserir(d);
            count++;
          } catch (e: any) {
            if (!(args.skipDuplicates && e?.code === 'P2002')) throw e;
          }
        }
        return { count };
      },
      update: async (args: any) => {
        const alvo = linhas().find((l) => casa(l, args.where));
        if (!alvo) throw erroNaoEncontrado();
        const nova = { ...alvo };
        aplicarDados(nova, args.data);
        conferirUnicos(nova, alvo);
        Object.assign(alvo, nova);
        return projetar(alvo, args.select);
      },
      updateMany: async (args: any) => {
        const alvos = linhas().filter((l) => casa(l, args.where));
        for (const alvo of alvos) {
          const nova = { ...alvo };
          aplicarDados(nova, args.data);
          conferirUnicos(nova, alvo);
          Object.assign(alvo, nova);
        }
        return { count: alvos.length };
      },
      upsert: async (args: any) => {
        const alvo = linhas().find((l) => casa(l, args.where));
        if (alvo) {
          const nova = { ...alvo };
          aplicarDados(nova, args.update);
          conferirUnicos(nova, alvo);
          Object.assign(alvo, nova);
          return copia(alvo);
        }
        return copia(inserir(args.create));
      },
      delete: async (args: any) => {
        const i = linhas().findIndex((l) => casa(l, args.where));
        if (i < 0) throw erroNaoEncontrado();
        const [removida] = linhas().splice(i, 1);
        return copia(removida);
      },
      deleteMany: async (args: any = {}) => {
        const antes = linhas().length;
        dados[nome] = linhas().filter((l) => !casa(l, args.where));
        return { count: antes - dados[nome].length };
      },
    };
    return { api, inserir };
  }

  const cache: Record<string, any> = {};
  const banco: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'isConnected') return true;
        if (prop === 'then') return undefined;
        if (prop === '$transaction') {
          return async (arg: any) => (typeof arg === 'function' ? arg(banco) : Promise.all(arg));
        }
        if (prop === 'linhas') return (t: string) => (dados[t] ?? []);
        if (prop === 'semear') {
          return (t: string, ls: Linha[]) => ls.map((l) => copia(delegado(t).inserir(l)));
        }
        if (!cache[prop]) cache[prop] = delegado(prop).api;
        return cache[prop];
      },
    },
  );
  return banco as BancoFalso;
}

describe('banco falso dos testes do Guarita', () => {
  it('respeita índice único (P2002) e filtros básicos', async () => {
    const db = criarBancoFalso();
    await db.guarita_Eventos.create({ data: { id_device: 1, chave: 'a', frame_hex: 'x', origem: 'ao_vivo', id_condominio: 1 } });
    await expect(
      db.guarita_Eventos.create({ data: { id_device: 1, chave: 'a', frame_hex: 'y', origem: 'recuperacao', id_condominio: 1 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await db.guarita_Eventos.create({ data: { id_device: 2, chave: 'a', frame_hex: 'z', origem: 'ao_vivo', id_condominio: 1 } });
    expect(await db.guarita_Eventos.count({ where: { chave: 'a' } })).toBe(2);
    expect(await db.guarita_Eventos.count({ where: { id_device: { in: [2, 3] } } })).toBe(1);
    const r = await db.guarita_Operacoes.updateMany({ where: { estado: 'pendente' }, data: { estado: 'enviada' } });
    expect(r.count).toBe(0);
  });
});
