/**
 * Tick de reservas das áreas sociais (re-enrola as aprovadas de hoje). O "hoje"
 * vinha de `toISOString()` — o dia em UTC. Depois das 21h em Brasília o UTC já
 * virou o dia seguinte: o tick procurava as reservas de amanhã e deixava sem
 * reconciliação as da noite de hoje. Agora usa a data de Brasília, como
 * `proximaOutraReservaAprovada`.
 */
let FacialService: any;

describe('FacialService — tickReservasAreas usa a data de Brasília', () => {
  beforeAll(() => {
    jest.useFakeTimers({ advanceTimers: true });
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => jest.useRealTimers());

  function build() {
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => []) },
    };
    const svc = new FacialService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('às 22h30 de Brasília (01h30 UTC do dia seguinte) busca as reservas de HOJE em Brasília', async () => {
    jest.setSystemTime(new Date('2026-07-21T01:30:00.000Z')); // 20/07 22:30 em Brasília
    const { svc, prisma } = build();
    await (svc as any).tickReservasAreas();
    const where = prisma.areas_Sociais_Agendamentos.findMany.mock.calls[0][0].where;
    expect(where.data).toEqual(new Date('2026-07-20'));
  });

  it('de tarde (mesmo dia nos dois fusos) segue igual', async () => {
    jest.setSystemTime(new Date('2026-07-20T18:00:00.000Z')); // 20/07 15:00 em Brasília
    const { svc, prisma } = build();
    await (svc as any).tickReservasAreas();
    const where = prisma.areas_Sociais_Agendamentos.findMany.mock.calls[0][0].where;
    expect(where.data).toEqual(new Date('2026-07-20'));
  });

  describe('reserva que termina 00:00 (20:00–24:00)', () => {
    // O mock devolve a reserva de 20/07 nos dois horários: o que se testa aqui é
    // a checagem "já terminou?" do próprio tick, não o filtro por dia do banco.
    const AG_ATE_MEIA_NOITE = {
      id: 77,
      data: new Date('2026-07-20T00:00:00.000Z'),
      hora_de: new Date('1970-01-01T20:00:00.000Z'),
      hora_ate: new Date('1970-01-01T00:00:00.000Z'),
    };

    function buildComReserva() {
      const { svc, prisma } = build();
      prisma.areas_Sociais_Agendamentos.findMany = jest.fn(async () => [AG_ATE_MEIA_NOITE]);
      const sync = jest.spyOn(svc as any, 'syncReservaArea').mockResolvedValue({ ok: true });
      return { svc, sync };
    }

    it('às 23:30 do dia da reserva está na janela: o tick (re)enrola', async () => {
      jest.setSystemTime(new Date('2026-07-21T02:30:00.000Z')); // 20/07 23:30 em Brasília
      const { svc, sync } = buildComReserva();
      await (svc as any).tickReservasAreas();
      expect(sync).toHaveBeenCalledWith(77);
    });

    it('à 00:10 do dia seguinte já terminou: o tick pula', async () => {
      jest.setSystemTime(new Date('2026-07-21T03:10:00.000Z')); // 21/07 00:10 em Brasília
      const { svc, sync } = buildComReserva();
      await (svc as any).tickReservasAreas();
      expect(sync).not.toHaveBeenCalled();
    });
  });
});
