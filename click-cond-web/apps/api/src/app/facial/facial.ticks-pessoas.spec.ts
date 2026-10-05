/**
 * Ticks de expiração, pré-enrolamento e dias da semana com a modelagem nova.
 * Com `PESSOAS_MIGRATION_ENABLED`, visitantes/prestadores vivem em `Pessoas`
 * + `Visitas`; se os ticks só olham `Visitantes`, ninguém sai do aparelho
 * quando a visita vence, ninguém é pré-enrolado e o teto de fim-de-dia de
 * `dias_semana` nunca é reestendido na virada.
 *
 * Mocks, sem banco e sem aparelho. O filtro de elegibilidade é do Prisma, então
 * o mock de `pessoas.findMany` aplica um avaliador mínimo do `where` sobre as
 * fixtures — o suficiente para provar que a pessoa elegível passa e a outra não.
 */
let FacialService: any;

type Visita = {
  liberado?: number;
  data_hora_inicio?: Date | null;
  data_hora_termino?: Date | null;
  dias_semana?: string | null;
};
type Pessoa = {
  id: number;
  face_id: string | null;
  foto_pessoa: string | null;
  face_sync_status?: string | null;
  visitas: Visita[];
};

// Avaliador mínimo dos operadores que os ticks usam.
function casaCampo(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (typeof cond !== 'object' || cond instanceof Date) return valor === cond;
  if ('not' in cond) {
    if (cond.not === null) return valor !== null && valor !== undefined;
    // Como no SQL: `<> 'x'` não casa NULL.
    if (valor === null || valor === undefined) return false;
    return valor !== cond.not;
  }
  if (valor === null || valor === undefined) return false;
  if ('lt' in cond && !(valor < cond.lt)) return false;
  if ('gte' in cond && !(valor >= cond.gte)) return false;
  if ('lte' in cond && !(valor <= cond.lte)) return false;
  return true;
}
function casa(obj: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, cond]: [string, any]) => {
    if (k === 'OR') return cond.some((w: any) => casa(obj, w));
    if (k === 'AND') return cond.every((w: any) => casa(obj, w));
    if (k === 'visitas') return (obj.visitas as Visita[]).some((v) => casa(v, cond.some));
    return casaCampo(obj[k], cond);
  });
}

describe('FacialService — ticks cobrem Pessoas', () => {
  const flagOriginal = process.env.PESSOAS_MIGRATION_ENABLED;
  // 00:30 BRT (03:30Z) — tickDiasSemanaSync só roda na hora 0 BRT.
  const AGORA = new Date('2026-10-05T03:30:00Z');
  const min = (m: number) => new Date(AGORA.getTime() + m * 60 * 1000);

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

  function build(pessoas: Pessoa[]) {
    const prisma: any = {
      isConnected: true,
      visitantes: { findMany: jest.fn(async () => []), update: jest.fn() },
      prestadores_servico: { findMany: jest.fn(async () => []) },
      pessoas: {
        findMany: jest.fn(async (args: any) =>
          pessoas.filter((p) => casa(p, args?.where)).map((p) => ({ id: p.id })),
        ),
      },
      visitas: { update: jest.fn(), updateMany: jest.fn() },
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
    const syncPessoa = jest.fn(async () => ({ ok: true }));
    svc.syncPessoa = syncPessoa;
    // Silencia os logs esperados do disparo em segundo plano.
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return { svc, prisma, syncPessoa };
  }

  const assentar = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  describe('tickExpiracaoAutomatica', () => {
    const pessoas: Pessoa[] = [
      // elegível: enrolada e com visita vencida
      { id: 2000001, face_id: 'pessoa_2000001', foto_pessoa: 'f', visitas: [{ liberado: 1, data_hora_termino: min(-10) }] },
      // não elegível: visita ainda vigente
      { id: 2000002, face_id: 'pessoa_2000002', foto_pessoa: 'f', visitas: [{ liberado: 1, data_hora_termino: min(60) }] },
      // não elegível: visita vencida, mas já fora do aparelho
      { id: 2000003, face_id: null, foto_pessoa: 'f', visitas: [{ liberado: 1, data_hora_termino: min(-10) }] },
      // não elegível: já revogada (mantém face_id) — reenviar a remoção a cada tick é desperdício
      { id: 2000004, face_id: 'pessoa_2000004', foto_pessoa: 'f', face_sync_status: 'revoked', visitas: [{ liberado: 1, data_hora_termino: min(-10) }] },
      // não elegível: visita venceu há mais de 2h (sobra coberta por validTo/tickSyncRetry)
      { id: 2000005, face_id: 'pessoa_2000005', foto_pessoa: 'f', face_sync_status: 'synced', visitas: [{ liberado: 1, data_hora_termino: min(-180) }] },
    ];

    it('com a flag ligada, re-sincroniza só quem tem visita vencida e face_id', async () => {
      const { svc, syncPessoa } = build(pessoas);
      await svc.tickExpiracaoAutomatica();
      await assentar();
      expect(syncPessoa).toHaveBeenCalledTimes(1);
      expect(syncPessoa).toHaveBeenCalledWith(2000001);
      expect(syncPessoa).not.toHaveBeenCalledWith(2000004);
      expect(syncPessoa).not.toHaveBeenCalledWith(2000005);
      expect((svc as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('tickExpiracaoAutomatica pessoas: 1 sincronizado(s), 0 ignorado(s) (skip), 0 falha(s) de 1'),
      );
    });

    it('não altera Visitas.liberado (quem está dentro perderia o leitor de saída)', async () => {
      const { svc, prisma } = build(pessoas);
      await svc.tickExpiracaoAutomatica();
      await assentar();
      expect(prisma.visitas.update).not.toHaveBeenCalled();
      expect(prisma.visitas.updateMany).not.toHaveBeenCalled();
    });

    it('com a flag desligada, não consulta pessoas', async () => {
      process.env.PESSOAS_MIGRATION_ENABLED = 'false';
      const { svc, prisma, syncPessoa } = build(pessoas);
      await svc.tickExpiracaoAutomatica();
      await assentar();
      expect(prisma.pessoas.findMany).not.toHaveBeenCalled();
      expect(syncPessoa).not.toHaveBeenCalled();
    });
  });

  describe('tickPreEnrolamento', () => {
    const pessoas: Pessoa[] = [
      // elegível: foto, sem face_id, visita liberada começando em 10 min
      { id: 2000001, face_id: null, foto_pessoa: 'f', visitas: [{ liberado: 1, data_hora_inicio: min(10) }] },
      // não elegível: começa em 2h
      { id: 2000002, face_id: null, foto_pessoa: 'f', visitas: [{ liberado: 1, data_hora_inicio: min(120) }] },
      // não elegível: visita não liberada
      { id: 2000003, face_id: null, foto_pessoa: 'f', visitas: [{ liberado: 0, data_hora_inicio: min(10) }] },
      // não elegível: já enrolada
      { id: 2000004, face_id: 'pessoa_2000004', foto_pessoa: 'f', visitas: [{ liberado: 1, data_hora_inicio: min(10) }] },
      // não elegível: sem foto
      { id: 2000005, face_id: null, foto_pessoa: null, visitas: [{ liberado: 1, data_hora_inicio: min(10) }] },
      // elegível: visitante que volta — revogado na visita anterior, mantém face_id
      { id: 2000006, face_id: 'pessoa_2000006', foto_pessoa: 'f', face_sync_status: 'revoked', visitas: [{ liberado: 1, data_hora_inicio: min(10) }] },
    ];

    it('com a flag ligada, pré-enrola só quem começa nos próximos 30 min (inclusive quem volta revogado)', async () => {
      const { svc, syncPessoa } = build(pessoas);
      await svc.tickPreEnrolamento();
      await assentar();
      expect(syncPessoa).toHaveBeenCalledTimes(2);
      expect(syncPessoa).toHaveBeenCalledWith(2000001);
      expect(syncPessoa).toHaveBeenCalledWith(2000006);
      expect((svc as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('tickPreEnrolamento pessoas: 2 pré-enrolado(s), 0 ignorado(s) (skip), 0 falha(s) de 2'),
      );
    });

    it('com a flag desligada, não consulta pessoas', async () => {
      process.env.PESSOAS_MIGRATION_ENABLED = 'false';
      const { svc, prisma, syncPessoa } = build(pessoas);
      await svc.tickPreEnrolamento();
      await assentar();
      expect(prisma.pessoas.findMany).not.toHaveBeenCalled();
      expect(syncPessoa).not.toHaveBeenCalled();
    });
  });

  describe('tickDiasSemanaSync', () => {
    const pessoas: Pessoa[] = [
      // elegível: enrolada, visita com dias_semana
      { id: 2000001, face_id: 'pessoa_2000001', foto_pessoa: null, visitas: [{ liberado: 1, dias_semana: 'seg,qua' }] },
      // elegível: só foto, visita com dias_semana
      { id: 2000002, face_id: null, foto_pessoa: 'f', visitas: [{ liberado: 1, dias_semana: 'ter' }] },
      // não elegível: visita sem dias_semana
      { id: 2000003, face_id: 'pessoa_2000003', foto_pessoa: 'f', visitas: [{ liberado: 1, dias_semana: null }] },
      // não elegível: sem foto e sem face_id
      { id: 2000004, face_id: null, foto_pessoa: null, visitas: [{ liberado: 1, dias_semana: 'seg' }] },
      // não elegível: todas as visitas com dias_semana já terminaram
      { id: 2000005, face_id: 'pessoa_2000005', foto_pessoa: 'f', visitas: [{ liberado: 1, dias_semana: 'seg', data_hora_termino: min(-60) }] },
      // elegível: revogada, mas com visita de dias_semana ainda vigente — reenrola no dia permitido
      { id: 2000006, face_id: 'pessoa_2000006', foto_pessoa: 'f', face_sync_status: 'revoked', visitas: [{ liberado: 1, dias_semana: 'qua', data_hora_termino: min(60 * 24 * 7) }] },
    ];

    it('com a flag ligada, re-sincroniza quem tem visita com dias_semana', async () => {
      const { svc, syncPessoa } = build(pessoas);
      await svc.tickDiasSemanaSync();
      await assentar();
      expect(syncPessoa).toHaveBeenCalledTimes(3);
      expect(syncPessoa).toHaveBeenCalledWith(2000001);
      expect(syncPessoa).toHaveBeenCalledWith(2000002);
      expect(syncPessoa).toHaveBeenCalledWith(2000006);
    });

    it('falha ao consultar pessoas não impede o bloco de prestadores', async () => {
      const { svc, prisma } = build(pessoas);
      prisma.pessoas.findMany.mockRejectedValueOnce(new Error('tabela indisponível'));
      await svc.tickDiasSemanaSync();
      await assentar();
      expect(prisma.prestadores_servico.findMany).toHaveBeenCalled();
    });

    it('conta skip e falha à parte no log', async () => {
      const { svc, syncPessoa } = build(pessoas);
      syncPessoa.mockResolvedValueOnce({ skipped: true } as any);
      syncPessoa.mockRejectedValueOnce(new Error('aparelho offline'));
      await svc.tickDiasSemanaSync();
      await assentar();
      expect((svc as any).logger.log).toHaveBeenCalledWith(
        expect.stringContaining('tickDiasSemanaSync pessoas: 1 sincronizado(s), 1 ignorado(s) (skip), 1 falha(s) de 3'),
      );
    });

    it('fora da hora 0 BRT não faz nada', async () => {
      jest.setSystemTime(new Date('2026-10-05T15:00:00Z'));
      const { svc, prisma, syncPessoa } = build(pessoas);
      await svc.tickDiasSemanaSync();
      await assentar();
      expect(prisma.pessoas.findMany).not.toHaveBeenCalled();
      expect(syncPessoa).not.toHaveBeenCalled();
    });

    it('com a flag desligada, não consulta pessoas', async () => {
      process.env.PESSOAS_MIGRATION_ENABLED = 'false';
      const { svc, prisma, syncPessoa } = build(pessoas);
      await svc.tickDiasSemanaSync();
      await assentar();
      expect(prisma.pessoas.findMany).not.toHaveBeenCalled();
      expect(syncPessoa).not.toHaveBeenCalled();
    });
  });
});
