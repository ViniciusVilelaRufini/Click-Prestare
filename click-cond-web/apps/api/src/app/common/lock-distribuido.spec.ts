import { comLock, executarComLock, nomeDoLockMysql } from './lock-distribuido';

/**
 * Simula o MySQL: GET_LOCK/RELEASE_LOCK por sessão. Cada `$transaction`
 * ganha uma "sessão" própria (como uma conexão do pool), e o lock nomeado é
 * de quem o pegou até RELEASE_LOCK na MESMA sessão.
 */
function prismaFalso() {
  const donos = new Map<string, number>();
  let proximaSessao = 1;
  const chamadas: { sessao: number; sql: string; nome: string }[] = [];
  const prisma = {
    isConnected: true,
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const sessao = proximaSessao++;
      const tx = {
        $queryRaw: jest.fn(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
          const sql = partes.join('?');
          const nome = String(valores[0]);
          chamadas.push({ sessao, sql, nome });
          if (sql.includes('GET_LOCK')) {
            const dono = donos.get(nome);
            if (dono === undefined || dono === sessao) {
              donos.set(nome, sessao);
              return [{ ok: BigInt(1) }];
            }
            return [{ ok: BigInt(0) }];
          }
          if (sql.includes('RELEASE_LOCK')) {
            if (donos.get(nome) === sessao) donos.delete(nome);
            return [{ ok: BigInt(1) }];
          }
          throw new Error('SQL inesperado: ' + sql);
        }),
      };
      return fn(tx);
    }),
  };
  return { prisma, donos, chamadas };
}

describe('executarComLock (GET_LOCK do MySQL)', () => {
  it('roda a função e libera o lock na mesma sessão', async () => {
    const { prisma, donos, chamadas } = prismaFalso();
    const fn = jest.fn(async () => undefined);

    const rodou = await executarComLock(prisma as any, 'facial:fantasmas', fn);

    expect(rodou).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(donos.size).toBe(0);
    const sessoes = new Set(chamadas.map((c) => c.sessao));
    expect(sessoes.size).toBe(1); // GET e RELEASE na mesma conexão
    expect(chamadas.map((c) => c.sql.includes('GET_LOCK') ? 'get' : 'release')).toEqual(['get', 'release']);
  });

  it('o segundo chamador concorrente recebe false e não roda', async () => {
    const { prisma } = prismaFalso();
    let soltar!: () => void;
    const primeiroSegura = new Promise<void>((r) => (soltar = r));
    const fn1 = jest.fn(() => primeiroSegura);
    const fn2 = jest.fn(async () => undefined);

    const p1 = executarComLock(prisma as any, 'superlogica:sync', fn1);
    // deixa o primeiro pegar o lock
    await new Promise((r) => setImmediate(r));
    const r2 = await executarComLock(prisma as any, 'superlogica:sync', fn2);
    soltar();
    const r1 = await p1;

    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();
  });

  it('depois que o primeiro termina, o lock volta a ficar livre', async () => {
    const { prisma } = prismaFalso();
    expect(await executarComLock(prisma as any, 'x', async () => undefined)).toBe(true);
    expect(await executarComLock(prisma as any, 'x', async () => undefined)).toBe(true);
  });

  it('erro dentro do job é logado, o lock é liberado e nada rejeita', async () => {
    const { prisma, donos } = prismaFalso();
    const rodou = await executarComLock(prisma as any, 'y', async () => {
      throw new Error('falhou');
    });
    expect(rodou).toBe(true);
    expect(donos.size).toBe(0);
  });

  it('banco fora do ar: não roda e devolve false (sem rejeitar)', async () => {
    const prisma = {
      isConnected: true,
      $transaction: jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    };
    const fn = jest.fn(async () => undefined);
    expect(await executarComLock(prisma as any, 'z', fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('sem banco (modo offline / testes): roda direto, como uma instância só', async () => {
    const fn = jest.fn(async () => undefined);
    expect(await executarComLock({ isConnected: false } as any, 'w', fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('executarComLock — intervaloMinimoMs (uma execução por período no cluster)', () => {
  /** Delegate mínimo de estado_compartilhado, dividido pelas "instâncias". */
  function comEstado(prisma: any) {
    const linhas = new Map<string, any>();
    prisma.estado_Compartilhado = {
      findUnique: jest.fn(async ({ where }: any) => linhas.get(where.chave) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) =>
        linhas.set(where.chave, linhas.has(where.chave) ? { ...linhas.get(where.chave), ...update } : create),
      ),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    };
    return linhas;
  }

  it('a outra instância, no mesmo período, pega o lock mas NÃO roda de novo', async () => {
    const { prisma } = prismaFalso();
    comEstado(prisma);
    const fn = jest.fn(async () => undefined);
    const opcoes = { intervaloMinimoMs: 60 * 60 * 1000 };

    expect(await executarComLock(prisma as any, 'financeiro:lembretes', fn, opcoes)).toBe(true);
    // ticks da instância B, 30 min depois (mesma hora-gatilho)
    expect(await executarComLock(prisma as any, 'financeiro:lembretes', fn, opcoes)).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passado o período, roda de novo', async () => {
    const { prisma } = prismaFalso();
    const linhas = comEstado(prisma);
    const fn = jest.fn(async () => undefined);
    await executarComLock(prisma as any, 'j', fn, { intervaloMinimoMs: 1000 });
    for (const l of linhas.values()) l.valor = JSON.stringify(Date.now() - 5000);
    expect(await executarComLock(prisma as any, 'j', fn, { intervaloMinimoMs: 1000 })).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('execução que falhou não marca o período (a próxima tentativa roda)', async () => {
    const { prisma } = prismaFalso();
    comEstado(prisma);
    const fn = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('ERP fora'))
      .mockResolvedValueOnce(undefined);
    await executarComLock(prisma as any, 'k', fn, { intervaloMinimoMs: 60_000 });
    await executarComLock(prisma as any, 'k', fn, { intervaloMinimoMs: 60_000 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('comLock', () => {
  it('devolve o valor da função e propaga o erro dela', async () => {
    const { prisma, donos } = prismaFalso();
    await expect(comLock(prisma as any, 'a', async () => 42)).resolves.toEqual({ obtido: true, valor: 42 });
    await expect(
      comLock(prisma as any, 'a', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(donos.size).toBe(0);
  });

  it('repassa a espera em segundos para o GET_LOCK', async () => {
    const { prisma, chamadas } = prismaFalso();
    const tx = { $queryRaw: jest.fn(async () => [{ ok: 1 }]) };
    prisma.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));
    await comLock(prisma as any, 'b', async () => 1, { esperaSegundos: 30 });
    const [, , espera] = (tx.$queryRaw.mock.calls[0] as unknown[]) as [unknown, string, number];
    expect(espera).toBe(30);
    expect(chamadas).toHaveLength(0);
  });
});

describe('nomeDoLockMysql', () => {
  it('prefixa e respeita o limite de 64 caracteres do MySQL', () => {
    expect(nomeDoLockMysql('facial:tick')).toBe('prestare:facial:tick');
    const longo = nomeDoLockMysql('x'.repeat(200));
    expect(longo.length).toBeLessThanOrEqual(64);
    expect(longo.startsWith('prestare:')).toBe(true);
    expect(nomeDoLockMysql('x'.repeat(200))).toBe(longo);
  });
});
