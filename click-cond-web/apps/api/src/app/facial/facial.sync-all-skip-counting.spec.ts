/**
 * Important 4 (Lote B): `syncAllForCondominio` alimentava `Visitantes.id`
 * pra `syncVisitante`, que com a flag ligada resolve contra `Visitas` (não
 * migrada por este bulk sync — fora de escopo aqui) e devolve
 * `{ skipped: true }` em vez de sincronizar de fato. O código contava esse
 * retorno como `ok++`, igual um sucesso real — o log "N ok" mentia sobre
 * quantos rostos realmente chegaram ao aparelho.
 *
 * Este spec prova que `skipped` agora é contado à parte de `ok`, e que o log
 * final reflete os dois números separadamente.
 */
let FacialService: any;

describe('FacialService.syncAllForCondominio — skip não conta como sincronizado (Lote B, Important 4)', () => {
  beforeAll(() => {
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });

  function buildService() {
    const prisma: any = {
      isConnected: true,
      facial_Devices: { findMany: jest.fn(async () => [{ id: 1 }]) },
      moradores: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => [{ id: 10 }, { id: 11 }, { id: 12 }]) },
      prestadores_servico: { findMany: jest.fn(async () => []) },
    };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const svc = new FacialService(
      prisma,
      {} as any, // client (device)
      { sendPushNotification: jest.fn() } as any, // notifications
      { consumeForDevice: jest.fn(() => null) } as any, // enrollSessions
      { registrar: jest.fn() } as any, // auditoria
      accessState,
      {} as any, // agent
    );
    return { svc, prisma };
  }

  async function aguardarBulkSyncTerminar(svc: any, idCondominio: number) {
    for (let i = 0; i < 100 && svc.bulkSyncEmAndamento.has(idCondominio); i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(svc.bulkSyncEmAndamento.has(idCondominio)).toBe(false);
  }

  it('conta skip separado de ok e o log distingue "N sincronizado(s)" de "M ignorado(s)"', async () => {
    const { svc } = buildService();
    // 3 visitantes: 2 vêm de `Visitantes.id` que não resolve mais contra
    // `Visitas` (flag ON) — skip — e 1 sincroniza de verdade.
    jest
      .spyOn(svc as any, 'syncVisitante')
      .mockResolvedValueOnce({ skipped: true, reason: 'visita_nao_encontrada' })
      .mockResolvedValueOnce({ skipped: true, reason: 'visita_nao_encontrada' })
      .mockResolvedValueOnce({ ok: true });
    const logSpy = jest.spyOn((svc as any).logger, 'log');

    const inicio = await svc.syncAllForCondominio(1);
    expect(inicio).toEqual({ total: 3, started: true });

    await aguardarBulkSyncTerminar(svc, 1);

    const chamada = logSpy.mock.calls.find(([msg]: any[]) =>
      String(msg).includes('Bulk sync condomínio 1'),
    );
    expect(chamada).toBeTruthy();
    const mensagem = String(chamada![0]);
    expect(mensagem).toContain('1 sincronizado(s)');
    expect(mensagem).toContain('2 ignorado(s) (skip)');
    expect(mensagem).toContain('0 falha(s)');
    expect(mensagem).toContain('de 3');
  });
});
