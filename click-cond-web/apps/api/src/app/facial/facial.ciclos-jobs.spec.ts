/**
 * Ciclos assíncronos do facial (revisão ciclos-api-jobs, J1/J10/J15).
 *
 * J1  - a marca `facial:bulk:<id>` vivia 2 h e só saía no `finally`: deploy no
 *       meio do bulk travava o condomínio (alreadyRunning) por até 2 h. Agora o
 *       TTL é curto e renovado por heartbeat enquanto o bulk roda.
 * J10 - a expiração automática legada (`Visitantes`) não tinha limite inferior:
 *       todo visitante vencido com face_id voltava a cada 15 min, para sempre.
 * J15 - `tickDiasSemanaSync` engolia a falha e o wrapper do cluster marcava o
 *       ciclo do dia como feito.
 *
 * Mocks, sem banco: o EstadoCompartilhado cai no Map do processo.
 */
let FacialService: any;

const MIN = 60 * 1000;

function casaCampo(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (typeof cond !== 'object' || cond instanceof Date) return valor === cond;
  if ('not' in cond) {
    if (cond.not === null) return valor !== null && valor !== undefined;
    if (valor === null || valor === undefined) return false;
    return valor !== cond.not;
  }
  if (valor === null || valor === undefined) return false;
  if ('lt' in cond && !(valor < cond.lt)) return false;
  if ('gte' in cond && !(valor >= cond.gte)) return false;
  return true;
}
function casa(obj: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return cond.some((w: any) => casa(obj, w));
    if (k === 'AND') return cond.every((w: any) => casa(obj, w));
    return casaCampo(obj[k], cond);
  });
}

const assentar = async (n = 50) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe('FacialService — ciclos dos jobs (J1, J10, J15)', () => {
  const flagOriginal = process.env.PESSOAS_MIGRATION_ENABLED;
  beforeAll(() => {
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => {
    if (flagOriginal === undefined) delete process.env.PESSOAS_MIGRATION_ENABLED;
    else process.env.PESSOAS_MIGRATION_ENABLED = flagOriginal;
  });
  beforeEach(() => {
    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function build(prismaExtra: Record<string, any> = {}) {
    const prisma: any = {
      isConnected: true,
      facial_Devices: { findMany: jest.fn(async () => [{ id: 1 }]) },
      moradores: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => [{ id: 10, id_condominio: 1 }]), update: jest.fn(async () => ({})) },
      prestadores_servico: { findMany: jest.fn(async () => []) },
      ...prismaExtra,
    };
    const svc = new FacialService(
      prisma,
      {} as any,
      { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn(() => null) } as any,
      { registrar: jest.fn(async () => undefined) } as any,
      { shouldDebounce: jest.fn(() => false) } as any,
      { isOnline: jest.fn(() => true) } as any,
    );
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return { svc, prisma };
  }

  /** syncVisitante que só termina quando o teste mandar. */
  function syncSegurado(svc: any) {
    let soltar!: () => void;
    const segura = new Promise<void>((r) => (soltar = r));
    jest.spyOn(svc, 'syncVisitante').mockImplementation(async () => {
      await segura;
      return { ok: true };
    });
    return () => soltar();
  }

  const marca = (svc: any) => svc.estado.obter('facial:bulk:1');

  async function esperarFim(svc: any) {
    for (let i = 0; i < 200 && (await marca(svc)); i++) await assentar(5);
    expect(await marca(svc)).toBeNull();
  }

  // ------------------------------------------------------------------ J1
  describe('J1 — marca de bulk sync', () => {
    it('nasce com TTL curto (no máximo 10 min): dono que morre não trava o condomínio por horas', async () => {
      const { svc } = build();
      const soltar = syncSegurado(svc);

      expect(await svc.syncAllForCondominio(1)).toEqual({ total: 1, started: true });
      const m = await marca(svc);
      expect(m).not.toBeNull();
      expect(m!.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(10 * MIN);

      soltar();
      await esperarFim(svc);
    });

    it('o heartbeat renova a marca enquanto o bulk roda e para no finally', async () => {
      const { svc } = build();
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const soltar = syncSegurado(svc);

      await svc.syncAllForCondominio(1);
      // Bem além de qualquer TTL (inclusive o antigo de 2 h): só continua de pé se foi renovada.
      await jest.advanceTimersByTimeAsync(150 * MIN);
      expect(await marca(svc)).not.toBeNull();
      expect(await svc.syncAllForCondominio(1)).toEqual({ alreadyRunning: true });

      soltar();
      await esperarFim(svc);

      const definir = jest.spyOn(svc.estado, 'definir');
      await jest.advanceTimersByTimeAsync(30 * MIN);
      expect(definir).not.toHaveBeenCalledWith('facial:bulk:1', expect.anything(), expect.anything());
      expect(await marca(svc)).toBeNull();
    });

    it('unsync em massa usa a mesma marca curta com heartbeat', async () => {
      const { svc } = build({
        visitantes: { findMany: jest.fn(async () => [{ id: 10, id_condominio: 1, face_id: 'v10' }]), update: jest.fn() },
      });
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      let soltar!: () => void;
      const segura = new Promise<void>((r) => (soltar = r));
      jest.spyOn(svc, 'unsyncVisitante').mockImplementation(async () => {
        await segura;
        return true as any;
      });

      const r = await svc.unsyncAllForCondominio(1);
      expect(r).toEqual(expect.objectContaining({ started: true }));
      const m = await marca(svc);
      expect(m!.expiraEm.getTime() - Date.now()).toBeLessThanOrEqual(10 * MIN);
      await jest.advanceTimersByTimeAsync(150 * MIN);
      expect(await marca(svc)).not.toBeNull();

      soltar();
      await esperarFim(svc);
    });
  });

  // ------------------------------------------------------------------ J10
  describe('J10 — expiração automática legada', () => {
    it('só re-sincroniza visitante com face_id que venceu há pouco; o vencido antigo não volta a cada tick', async () => {
      const agora = Date.now();
      const visitantes = [
        // venceu há 10 min, ainda no aparelho: elegível
        { id: 1, id_condominio: 1, liberado: 0, face_id: 'v1', data_hora_termino: new Date(agora - 10 * MIN) },
        // venceu há 3 dias e o face_id nunca foi limpo (flag ligada / terminal mudo): fora
        { id: 2, id_condominio: 1, liberado: 0, face_id: 'v2', data_hora_termino: new Date(agora - 3 * 24 * 60 * MIN) },
        // venceu há 3 dias mas ainda liberado: zera uma vez (converge, não repete)
        { id: 3, id_condominio: 1, liberado: 1, face_id: null, data_hora_termino: new Date(agora - 3 * 24 * 60 * MIN) },
        // vigente: fora
        { id: 4, id_condominio: 1, liberado: 1, face_id: 'v4', data_hora_termino: new Date(agora + 60 * MIN) },
      ];
      const { svc, prisma } = build({
        visitantes: {
          findMany: jest.fn(async (args: any) => visitantes.filter((v) => casa(v, args?.where))),
          update: jest.fn(async () => ({})),
        },
      });
      const sync = jest.spyOn(svc, 'syncVisitante').mockResolvedValue({ ok: true });

      await svc.tickExpiracaoAutomatica();
      await assentar();

      expect(sync.mock.calls.map((c: any[]) => c[0]).sort()).toEqual([1, 3]);
      expect(prisma.visitantes.update).toHaveBeenCalledTimes(1);
      expect(prisma.visitantes.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { liberado: 0 } });
    });
  });

  // ------------------------------------------------------------------ J15
  describe('J15 — tickDiasSemanaSync não marca o dia quando falha', () => {
    // 00:30 BRT — o tick só roda na hora 0.
    const MEIA_NOITE_E_MEIA = new Date('2026-10-05T03:30:00Z');

    it('devolve false quando a consulta falha e true quando roda', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(MEIA_NOITE_E_MEIA);
      const { svc, prisma } = build();
      jest.spyOn(svc, 'syncVisitante').mockResolvedValue({ ok: true });

      prisma.visitantes.findMany.mockRejectedValueOnce(new Error('banco caiu'));
      expect(await svc.tickDiasSemanaSync()).toBe(false);
      expect(await svc.tickDiasSemanaSync()).not.toBe(false);
    });

    it('banco desconectado conta como não feito', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(MEIA_NOITE_E_MEIA);
      const { svc, prisma } = build();
      prisma.isConnected = false;
      expect(await svc.tickDiasSemanaSync()).toBe(false);
    });

    it('pelo wrapper do cluster: falha não grava o ciclo do dia e o próximo tick da hora 0 roda de novo', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      jest.setSystemTime(MEIA_NOITE_E_MEIA);
      const { svc, prisma } = build();
      jest.spyOn(svc, 'syncVisitante').mockResolvedValue({ ok: true });
      prisma.visitantes.findMany.mockRejectedValueOnce(new Error('banco caiu'));

      const tick = svc.noCluster('facial:tickDiasSemanaSync:teste-j15', () => svc.tickDiasSemanaSync(), {
        cicloDeNegocio: () => '2026-10-05',
      });
      tick();
      await assentar(200);
      expect(prisma.visitantes.findMany).toHaveBeenCalledTimes(1);

      tick(); // falhou: o dia não foi marcado, roda de novo
      await assentar(200);
      expect(prisma.visitantes.findMany).toHaveBeenCalledTimes(2);

      tick(); // agora deu certo: o dia está marcado, não roda mais
      await assentar(200);
      expect(prisma.visitantes.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
