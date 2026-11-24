/**
 * Só para os specs da carteira: Prisma em memória com o pedaço do Prisma que o
 * WalletService, o serviço da Apple e a validação usam. `where` aceita
 * igualdade, null, { in }, { startsWith }, { gt }, { lt } e { not: null }.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

// Este arquivo fica fora de *.spec.ts (é compartilhado) e por isso também é
// conferido pelo tsconfig da aplicação, que não tem os tipos do Jest.
declare const jest: any;

export interface EstadoFalso {
  condominios: any[];
  moradores: any[];
  creds: any[];
  registros: any[];
  /** Apartamentos_Users como { id_user, id_condominio } (o condomínio da unidade). */
  vinculos: any[];
  users: any[];
}

function casaValor(valor: any, cond: any): boolean {
  if (cond === null) return valor == null;
  if (cond instanceof Date) return valor instanceof Date && valor.getTime() === cond.getTime();
  if (cond && typeof cond === 'object') {
    if ('in' in cond && !cond.in.includes(valor)) return false;
    if ('startsWith' in cond && !(typeof valor === 'string' && valor.startsWith(cond.startsWith))) return false;
    if ('gt' in cond && !(valor != null && +valor > +cond.gt)) return false;
    if ('lt' in cond && !(valor != null && +valor < +cond.lt)) return false;
    if ('not' in cond && cond.not === null && valor == null) return false;
    return true;
  }
  return valor === cond;
}

export function casa(linha: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === 'OR') return (v as any[]).some((w) => casa(linha, w));
    if (k === 'credencial' || k === 'condominio') return true; // filtro por relação: tratado por quem chama
    if (v && typeof v === 'object' && !(v instanceof Date) && !('in' in v) && !('startsWith' in v) && !('gt' in v) && !('lt' in v) && !('not' in v)) {
      // chave composta (device_id_id_credencial)
      return casa(linha, v);
    }
    return casaValor(linha[k], v);
  });
}

function ordenar(linhas: any[], orderBy: any): any[] {
  if (!orderBy) return linhas;
  const [campo, dir] = Object.entries(orderBy)[0] as [string, string];
  return [...linhas].sort((a, b) => (dir === 'desc' ? -1 : 1) * (+a[campo] - +b[campo]));
}

function selecionar(linha: any, select: any) {
  if (!linha || !select) return linha;
  return Object.fromEntries(Object.keys(select).map((k) => [k, linha[k]]));
}

/** GET_LOCK/RELEASE_LOCK simulados (cada $transaction é uma sessão). */
function comGetLockFalso(prisma: any) {
  const donos = new Map<string, number>();
  const filas = new Map<string, Array<() => void>>();
  let sessoes = 0;
  prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
    const sessao = ++sessoes;
    const tx = {
      $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        const sql = partes.join('?');
        const nome = String(valores[0]);
        if (sql.includes('GET_LOCK')) {
          while (donos.has(nome) && donos.get(nome) !== sessao) {
            await new Promise<void>((r) => filas.set(nome, [...(filas.get(nome) ?? []), r]));
          }
          donos.set(nome, sessao);
          return [{ ok: BigInt(1) }];
        }
        if (sql.includes('RELEASE_LOCK')) {
          if (donos.get(nome) === sessao) donos.delete(nome);
          const espera = filas.get(nome) ?? [];
          filas.delete(nome);
          espera.forEach((r) => r());
          return [{ ok: BigInt(1) }];
        }
        throw new Error(`SQL inesperado: ${sql}`);
      },
    };
    return fn(tx);
  });
}

export function criarPrismaFalso(inicial: Partial<EstadoFalso> = {}, opcoes: { lento?: boolean } = {}) {
  const estado: EstadoFalso = {
    condominios: inicial.condominios ?? [],
    moradores: inicial.moradores ?? [],
    creds: inicial.creds ?? [],
    registros: inicial.registros ?? [],
    // Sem vínculos dados, cada morador com conta mora numa unidade do próprio condomínio.
    vinculos:
      inicial.vinculos ??
      (inicial.moradores ?? [])
        .filter((m: any) => m.id_user != null && m.id_condominio != null)
        .map((m: any) => ({ id_user: m.id_user, id_condominio: m.id_condominio })),
    users: inicial.users ?? [],
  };
  const ceder = () => (opcoes.lento ? new Promise<void>((r) => setImmediate(r)) : Promise.resolve());
  let proximoCred = 100 + estado.creds.length;
  let proximoReg = 1 + estado.registros.length;

  const aplicar = (linha: any, data: any) => {
    for (const [k, v] of Object.entries(data)) linha[k] = v;
  };

  const prisma: any = {
    isConnected: true,
    condominios: {
      findUnique: jest.fn(async ({ where, select }: any) =>
        selecionar(estado.condominios.find((c) => c.id === where.id) ?? null, select),
      ),
      update: jest.fn(async ({ where, data, select }: any) => {
        const c = estado.condominios.find((x) => x.id === where.id);
        if (!c) throw Object.assign(new Error('não existe'), { code: 'P2025' });
        aplicar(c, data);
        return selecionar(c, select);
      }),
    },
    moradores: {
      findFirst: jest.fn(async ({ where, orderBy, select }: any) =>
        selecionar(ordenar(estado.moradores.filter((m) => casa(m, where)), orderBy ?? { id: 'asc' })[0] ?? null, select),
      ),
      findUnique: jest.fn(async ({ where, select }: any) =>
        selecionar(estado.moradores.find((m) => m.id === where.id) ?? null, select),
      ),
      findMany: jest.fn(async ({ where, orderBy, select }: any) =>
        ordenar(estado.moradores.filter((m) => casa(m, where)), orderBy ?? { id: 'asc' }).map((m) => selecionar(m, select)),
      ),
    },
    credenciais_Acesso: {
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        await ceder();
        return ordenar(estado.creds.filter((c) => casa(c, where)), orderBy)[0] ?? null;
      }),
      findMany: jest.fn(async ({ where, select }: any) => {
        let linhas = estado.creds.filter((c) => casa(c, where));
        const cond = where?.condominio;
        if (cond) {
          linhas = linhas.filter((l) => casa(estado.condominios.find((c) => c.id === l.id_condominio) ?? {}, cond));
        }
        return linhas.map((l) => selecionar(l, select));
      }),
      findUnique: jest.fn(async ({ where, select }: any) =>
        selecionar(estado.creds.find((c) => c.id === where.id) ?? null, select),
      ),
      create: jest.fn(async ({ data }: any) => {
        await ceder();
        const c = {
          id: proximoCred++,
          id_visita: null,
          id_visitante: null,
          versao_link: 1,
          valido_de: null,
          valido_ate: null,
          revogada_em: null,
          criado_em: new Date(),
          wallet_atualizado_em: null,
          ...data,
        };
        estado.creds.push(c);
        return c;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        await ceder();
        const alvos = estado.creds.filter((c) => casa(c, where));
        alvos.forEach((c) => aplicar(c, data));
        return { count: alvos.length };
      }),
    },
    wallet_Registros: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const chave = where.device_id_id_credencial ?? where;
        return selecionar(
          estado.registros.find((r) => r.device_id === chave.device_id && r.id_credencial === chave.id_credencial) ?? null,
          select,
        );
      }),
      findMany: jest.fn(async ({ where, select, include, orderBy }: any) => {
        const linhas = ordenar(estado.registros.filter((r) => casa(r, where)), orderBy);
        return linhas.map((r) => {
          const base = selecionar(r, select) ?? { ...r };
          if (include?.credencial || select?.credencial) {
            base.credencial = estado.creds.find((c) => c.id === r.id_credencial) ?? null;
          }
          return base;
        });
      }),
      count: jest.fn(async ({ where }: any) => estado.registros.filter((r) => casa(r, where)).length),
      create: jest.fn(async ({ data }: any) => {
        if (estado.registros.some((r) => r.device_id === data.device_id && r.id_credencial === data.id_credencial)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const agora = new Date();
        const r = { id: proximoReg++, criado_em: agora, atualizado_em: agora, ...data };
        estado.registros.push(r);
        return r;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = estado.registros.find((x) => x.id === where.id);
        if (!r) throw Object.assign(new Error('não existe'), { code: 'P2025' });
        aplicar(r, data);
        return r;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const antes = estado.registros.length;
        estado.registros = estado.registros.filter((r) => !casa(r, where));
        return { count: antes - estado.registros.length };
      }),
    },
    apartamentos_Users: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          estado.vinculos.find(
            (v) => v.id_user === where.id_user && v.id_condominio === where.apartamento?.id_condominio,
          ) ?? null,
      ),
    },
    users: {
      findUnique: jest.fn(async ({ where, select }: any) =>
        selecionar(estado.users.find((u) => u.id === where.id) ?? null, select),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvos = estado.users.filter((u) => casa(u, where));
        alvos.forEach((u) => aplicar(u, data));
        return { count: alvos.length };
      }),
    },
    credenciais_Leituras: {
      create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  comGetLockFalso(prisma);
  return { prisma, estado };
}
