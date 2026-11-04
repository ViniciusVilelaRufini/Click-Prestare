import { EstadoCompartilhado, limparEstadoEmMemoria } from './estado-compartilhado';

/** Delegate Prisma falso de `estado_Compartilhado`, com a semântica do MySQL que importa aqui. */
function delegateFalso() {
  const linhas = new Map<string, any>();
  const casa = (l: any, where: any) => {
    if (where.chave !== undefined && typeof where.chave === 'string' && l.chave !== where.chave) return false;
    if (typeof where.chave === 'object' && where.chave?.startsWith !== undefined && !l.chave.startsWith(where.chave.startsWith)) return false;
    if (where.consumido_em === null && l.consumido_em !== null) return false;
    if (where.expira_em?.lte && !(l.expira_em <= where.expira_em.lte)) return false;
    if (where.expira_em?.gt && !(l.expira_em > where.expira_em.gt)) return false;
    return true;
  };
  return {
    linhas,
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const atual = linhas.get(where.chave);
      linhas.set(where.chave, atual ? { ...atual, ...update } : { ...create });
    }),
    findUnique: jest.fn(async ({ where }: any) => linhas.get(where.chave) ?? null),
    findMany: jest.fn(async ({ where }: any) => [...linhas.values()].filter((l) => casa(l, where))),
    create: jest.fn(async ({ data }: any) => {
      if (linhas.has(data.chave)) throw Object.assign(new Error('dup'), { code: 'P2002' });
      linhas.set(data.chave, { ...data });
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (const l of [...linhas.values()]) if (casa(l, where)) (linhas.delete(l.chave), count++);
      return { count };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const l of linhas.values()) if (casa(l, where)) (Object.assign(l, data), count++);
      return { count };
    }),
  };
}

describe.each([
  ['banco (Prisma)', () => new EstadoCompartilhado({ isConnected: true, estado_Compartilhado: delegateFalso() })],
  ['memória (sem banco)', () => new EstadoCompartilhado({ isConnected: false })],
])('EstadoCompartilhado — %s', (_nome, criar) => {
  beforeEach(() => limparEstadoEmMemoria());

  it('grava, lê e respeita o TTL', async () => {
    const e = criar();
    await e.definir('qr:1', { status: 'pending' }, 60_000);
    expect((await e.obter<any>('qr:1'))?.valor).toEqual({ status: 'pending' });
    await e.definir('qr:2', { a: 1 }, -1);
    expect(await e.obter('qr:2')).toBeNull();
  });

  it('reivindicar: só um de dois chamadores simultâneos ganha', async () => {
    const e = criar();
    await e.definir('acao:1', { x: 1 }, 60_000);
    const [a, b] = await Promise.all([e.reivindicar('acao:1'), e.reivindicar('acao:1')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await e.obter('acao:1'))?.consumidoEm).toBeInstanceOf(Date);
    await e.liberar('acao:1');
    expect(await e.reivindicar('acao:1', { x: 2 })).toBe(true);
    expect((await e.obter<any>('acao:1'))?.valor).toEqual({ x: 2 });
  });

  it('removerPorPrefixo: apaga só as chaves do prefixo', async () => {
    const e = criar();
    await e.definir('falha:a:1', 1, 60_000);
    await e.definir('falha:a:2', 1, 60_000);
    await e.definir('falha:b:1', 1, 60_000);
    await e.removerPorPrefixo('falha:a:');
    expect(await e.listarPorPrefixo('falha:a:')).toHaveLength(0);
    expect(await e.listarPorPrefixo('falha:b:')).toHaveLength(1);
  });

  it('criarSeAusente: não sobrescreve quem está valendo, mas ocupa o lugar de quem venceu', async () => {
    const e = criar();
    expect(await e.criarSeAusente('bulk:1', true, 60_000)).toBe(true);
    expect(await e.criarSeAusente('bulk:1', true, 60_000)).toBe(false);
    await e.definir('bulk:2', true, -1);
    expect(await e.criarSeAusente('bulk:2', true, 60_000)).toBe(true);
  });

  it('consumirUmaVez entrega uma vez só', async () => {
    const e = criar();
    await e.definir('pedido:5', true, 60_000);
    expect(await e.consumirUmaVez('pedido:5')).toBe(true);
    expect(await e.consumirUmaVez('pedido:5')).toBeNull();
  });

  it('lista por prefixo só o que vale e purga o vencido', async () => {
    const e = criar();
    await e.definir('enroll:7:a', 1, 60_000);
    await e.definir('enroll:7:b', 2, -1);
    await e.definir('enroll:8:c', 3, 60_000);
    const l = await e.listarPorPrefixo<number>('enroll:7:');
    expect(l.map((x) => x.valor)).toEqual([1]);
    expect(await e.purgarExpirados()).toBe(1);
  });
});

describe('EstadoCompartilhado — tabela ausente', () => {
  beforeEach(() => limparEstadoEmMemoria());

  it('cai para a memória do processo se o SQL ainda não foi aplicado (P2021)', async () => {
    const erro = Object.assign(new Error('table does not exist'), { code: 'P2021' });
    const db = { upsert: jest.fn().mockRejectedValue(erro), findUnique: jest.fn() };
    const e = new EstadoCompartilhado({ isConnected: true, estado_Compartilhado: db });
    await e.definir('k', 1, 60_000);
    expect((await e.obter<number>('k'))?.valor).toBe(1);
    expect(db.findUnique).not.toHaveBeenCalled();
  });
});
