/**
 * Q5: os ticks de autorização disparavam TODAS as pessoas de uma vez. O agente
 * executa um comando por vez em cada aparelho e descarta o que espera mais que
 * o prazo (~20 s): numa rajada de 40 cadastros, a maior parte expirava na fila.
 * Agora cada tick roda no máximo 3 syncs ao mesmo tempo por condomínio
 * (condomínios diferentes seguem em paralelo) e só termina — soltando o lock
 * do noCluster — quando todos acabaram.
 *
 * Mocks, sem banco e sem aparelho.
 */
let FacialService: any;

describe('FacialService — ticks com concorrência limitada por condomínio (Q5)', () => {
  const flagOriginal = process.env.PESSOAS_MIGRATION_ENABLED;
  // 00:30 BRT (03:30Z) — tickDiasSemanaSync só roda na hora 0 BRT.
  const AGORA = new Date('2026-10-05T03:30:00Z');

  beforeAll(() => {
    jest.useFakeTimers(); // neutraliza os setInterval/setTimeout do construtor
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => {
    jest.useRealTimers();
    if (flagOriginal === undefined) delete process.env.PESSOAS_MIGRATION_ENABLED;
    else process.env.PESSOAS_MIGRATION_ENABLED = flagOriginal;
  });
  beforeEach(() => {
    jest.setSystemTime(AGORA);
    process.env.PESSOAS_MIGRATION_ENABLED = 'true';
  });

  /** "Aparelho" controlado: cada sync fica em voo até o teste soltá-lo. */
  function controlado() {
    const emVoo = new Map<number, number>(); // condomínio → syncs em voo
    const maxPorCond = new Map<number, number>();
    const pendentes: Array<() => void> = [];
    let simultaneosEntreConds = false;
    const condDe = new Map<number, number>();
    const fn = jest.fn((id: number) => {
      const cond = condDe.get(id)!;
      emVoo.set(cond, (emVoo.get(cond) ?? 0) + 1);
      maxPorCond.set(cond, Math.max(maxPorCond.get(cond) ?? 0, emVoo.get(cond)!));
      if ([...emVoo.values()].filter((n) => n > 0).length > 1) simultaneosEntreConds = true;
      return new Promise<any>((resolve) => {
        pendentes.push(() => {
          emVoo.set(cond, emVoo.get(cond)! - 1);
          resolve({ ok: true });
        });
      });
    });
    return { fn, condDe, maxPorCond, pendentes, entreConds: () => simultaneosEntreConds };
  }

  const assentar = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  function build(prismaExtra: any) {
    const prisma: any = {
      isConnected: true,
      visitantes: { findMany: jest.fn(async () => []), update: jest.fn() },
      prestadores_servico: { findMany: jest.fn(async () => []) },
      pessoas: { findMany: jest.fn(async () => []) },
      visitas: { update: jest.fn(), updateMany: jest.fn() },
      ...prismaExtra,
    };
    const svc = new FacialService(
      prisma,
      {} as any,
      { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn() } as any,
      { registrar: jest.fn(async () => undefined) } as any,
      { shouldDebounce: jest.fn(() => false) } as any,
      { isOnline: jest.fn(() => true) } as any,
    );
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return svc;
  }

  /** Solta os syncs um a um até não sobrar nenhum; devolve se o tick terminou antes do fim. */
  async function drenar(c: ReturnType<typeof controlado>, terminou: () => boolean) {
    let terminouAntes = false;
    await assentar();
    while (c.pendentes.length > 0) {
      if (terminou()) terminouAntes = true;
      c.pendentes.shift()!();
      await assentar();
    }
    return terminouAntes;
  }

  it('tickExpiracaoAutomatica: no máximo 3 syncPessoa por condomínio, condomínios em paralelo, e só termina depois de todos', async () => {
    const c = controlado();
    const pessoas = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, id_condominio: 501 })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: 200 + i, id_condominio: 502 })),
    ];
    for (const p of pessoas) c.condDe.set(p.id, p.id_condominio);
    const svc = build({ pessoas: { findMany: jest.fn(async () => pessoas) } });
    svc.syncPessoa = c.fn;

    let fim = false;
    const tick = svc.tickExpiracaoAutomatica().then(() => (fim = true));
    const terminouAntes = await drenar(c, () => fim);
    await tick;

    expect(c.fn).toHaveBeenCalledTimes(14);
    expect(c.maxPorCond.get(501)).toBe(3);
    expect(c.maxPorCond.get(502)).toBe(3);
    expect(c.entreConds()).toBe(true);
    expect(terminouAntes).toBe(false);
    expect((svc as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('tickExpiracaoAutomatica pessoas: 14 sincronizado(s), 0 ignorado(s) (skip), 0 falha(s) de 14'),
    );
  });

  it('tickDiasSemanaSync: prestadores também entram no limite (antes eram todos de uma vez, sem esperar)', async () => {
    const c = controlado();
    const prestadores = Array.from({ length: 8 }, (_, i) => ({ id: 300 + i, id_condominio: 503 }));
    for (const p of prestadores) c.condDe.set(p.id, p.id_condominio);
    const svc = build({ prestadores_servico: { findMany: jest.fn(async () => prestadores) } });
    svc.syncPessoa = jest.fn(async () => ({ ok: true }));
    svc.syncPrestadorServico = c.fn;

    let fim = false;
    const tick = svc.tickDiasSemanaSync().then(() => (fim = true));
    const terminouAntes = await drenar(c, () => fim);
    await tick;

    expect(c.fn).toHaveBeenCalledTimes(8);
    expect(c.maxPorCond.get(503)).toBe(3);
    expect(terminouAntes).toBe(false);
  });

  it('tickPreEnrolamento: visitantes (modelo antigo) também respeitam o limite e o tick espera', async () => {
    const c = controlado();
    const visitantes = Array.from({ length: 7 }, (_, i) => ({ id: 400 + i, id_condominio: 504 }));
    for (const v of visitantes) c.condDe.set(v.id, v.id_condominio);
    const svc = build({ visitantes: { findMany: jest.fn(async () => visitantes), update: jest.fn() } });
    svc.syncVisitante = c.fn;

    let fim = false;
    const tick = svc.tickPreEnrolamento().then(() => (fim = true));
    const terminouAntes = await drenar(c, () => fim);
    await tick;

    expect(c.fn).toHaveBeenCalledTimes(7);
    expect(c.maxPorCond.get(504)).toBe(3);
    expect(terminouAntes).toBe(false);
  });
});
