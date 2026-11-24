/**
 * `where` do Prisma avaliado sobre uma linha em memória, para os bancos falsos
 * dos specs de visitantes. Cobre o que as gravações condicionais usam:
 * igualdade, `{ not: x }` (NULL não casa, como no SQL), `OR`, `AND` e `NOT`.
 */
export function casaWhere(linha: Record<string, any>, where: Record<string, any> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, cond]) => {
    if (campo === 'OR') return (cond as any[]).some((w) => casaWhere(linha, w));
    if (campo === 'AND') return (cond as any[]).every((w) => casaWhere(linha, w));
    if (campo === 'NOT') return !casaWhere(linha, cond);
    const valor = linha[campo] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return valor !== null && valor !== cond.not;
      if ('in' in cond) return (cond.in as any[]).includes(valor);
      return true;
    }
    return campo === 'id' ? Number(valor) === Number(cond) : valor === cond;
  });
}

/**
 * A gravação condicional mira UMA linha pelo id (número). Outras `updateMany`
 * do serviço (revogar códigos da pessoa, com `id: { not: x }`) não são dela.
 */
export function casaLinha(linha: Record<string, any>, where: Record<string, any> | undefined): boolean {
  return typeof where?.id === 'number' && Number(linha.id) === where.id && casaWhere(linha, where);
}

/**
 * `updateMany` + `findUnique` de uma tabela falsa com UMA linha (`linha`),
 * gravando nela como o `update` dos specs faz. `rel` monta o retorno com as
 * relações (pessoa, apartamento) que o `include` pediria. Sem jest aqui (o
 * arquivo entra no tsc do app): o spec embrulha em `jest.fn` se quiser espiar.
 */
export function gravacaoCondicional(linha: Record<string, any>, rel: (l: any) => any = (l) => l) {
  return {
    updateMany: async ({ where, data }: any) => {
      if (!casaLinha(linha, where)) return { count: 0 };
      Object.assign(linha, data);
      return { count: 1 };
    },
    findUnique: async (_args?: any) => rel(linha),
  };
}

/** O mesmo, para bancos falsos com várias linhas num `Map` por id. */
export function gravacaoCondicionalMapa(linhas: Map<number, any>, rel: (l: any) => any = (l) => l) {
  return {
    updateMany: async ({ where, data }: any) => {
      const linha = typeof where?.id === 'number' ? linhas.get(where.id) : undefined;
      if (!linha || !casaWhere(linha, where)) return { count: 0 };
      Object.assign(linha, data);
      return { count: 1 };
    },
    findUnique: async ({ where }: any) => {
      const linha = linhas.get(Number(where?.id));
      return linha ? rel(linha) : null;
    },
  };
}
