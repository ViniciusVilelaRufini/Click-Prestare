/**
 * "Remover rostos dos terminais" (POST /facial/sync/clean). Com a modelagem
 * nova, visitantes/prestadores vivem em `Pessoas` (face_id `pessoa_<id>`); se
 * a limpeza esquecer essa fonte, o rosto continua no aparelho abrindo a porta.
 *
 * Mocks, sem banco e sem aparelho.
 */
let FacialService: any;

describe('FacialService — unsyncAllForCondominio inclui Pessoas', () => {
  const flagOriginal = process.env.PESSOAS_MIGRATION_ENABLED;

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

  function build(pessoas: { id: number; face_id: string }[] = []) {
    const prisma: any = {
      isConnected: true,
      facial_Devices: { findMany: jest.fn(async () => [{ id: 7 }]) },
      moradores: { findMany: jest.fn(async () => []), update: jest.fn() },
      visitantes: { findMany: jest.fn(async () => []), update: jest.fn() },
      prestadores_servico: { findMany: jest.fn(async () => []), update: jest.fn() },
      pessoas: {
        findMany: jest.fn(async () => pessoas),
        update: jest.fn(async () => ({})),
      },
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
    const unsyncPessoa = jest.fn(async () => true);
    svc.unsyncPessoa = unsyncPessoa;
    // Silencia os logs esperados do disparo em segundo plano.
    jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    return { svc, prisma, unsyncPessoa };
  }

  // O laço roda em segundo plano (void async); deixa as promises assentarem.
  const assentar = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  beforeEach(() => {
    process.env.PESSOAS_MIGRATION_ENABLED = 'true';
  });

  it('com a flag ligada, remove as pessoas e zera o face_id', async () => {
    const { svc, prisma, unsyncPessoa } = build([
      { id: 2000001, face_id: 'pessoa_2000001' },
      { id: 2000002, face_id: 'pessoa_2000002' },
    ]);
    const r = await svc.unsyncAllForCondominio(1);
    await assentar();

    expect(r).toEqual({ total: 2, started: true });
    expect(unsyncPessoa).toHaveBeenCalledWith(2000001, 'pessoa_2000001', 1, { deviceIds: undefined });
    expect(unsyncPessoa).toHaveBeenCalledWith(2000002, 'pessoa_2000002', 1, { deviceIds: undefined });
    expect(prisma.pessoas.update).toHaveBeenCalledWith({
      where: { id: 2000001 },
      data: {
        face_id: null,
        face_sync_status: null,
        face_sync_error: null,
        face_enrolled_at: null,
      },
    });
  });

  it('com keepFaceId, mantém o face_id e marca pending', async () => {
    const { svc, prisma } = build([{ id: 2000001, face_id: 'pessoa_2000001' }]);
    await svc.unsyncAllForCondominio(1, { keepFaceId: true });
    await assentar();

    expect(prisma.pessoas.update).toHaveBeenCalledWith({
      where: { id: 2000001 },
      data: { face_sync_status: 'pending' },
    });
  });

  it('com a flag desligada, não consulta pessoas', async () => {
    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
    const { svc, prisma, unsyncPessoa } = build([{ id: 2000001, face_id: 'pessoa_2000001' }]);
    const r = await svc.unsyncAllForCondominio(1);

    expect(prisma.pessoas.findMany).not.toHaveBeenCalled();
    expect(unsyncPessoa).not.toHaveBeenCalled();
    expect(r).toEqual({ total: 0, started: false });
  });

  it('categoria prestador filtra tipo_pessoa', async () => {
    const { svc, prisma } = build();
    await svc.unsyncAllForCondominio(1, { categorias: ['prestador'] });

    const where = prisma.pessoas.findMany.mock.calls[0][0].where;
    expect(where.id_condominio).toBe(1);
    expect(where.face_id).toEqual({ not: null });
    expect(where.AND).toEqual([{ tipo_pessoa: 'prestador' }]);
  });

  it('categoria visitante exclui prestadores', async () => {
    const { svc, prisma } = build();
    await svc.unsyncAllForCondominio(1, { categorias: ['visitante'] });

    const where = prisma.pessoas.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([{ tipo_pessoa: { not: 'prestador' } }]);
  });

  it('só morador: não consulta pessoas', async () => {
    const { svc, prisma } = build();
    await svc.unsyncAllForCondominio(1, { categorias: ['morador'] });

    expect(prisma.pessoas.findMany).not.toHaveBeenCalled();
  });

  it('remoção que não chegou ao aparelho mantém face_id com status pending', async () => {
    const { svc, prisma, unsyncPessoa } = build([{ id: 2000001, face_id: 'pessoa_2000001' }]);
    unsyncPessoa.mockResolvedValueOnce(false);
    await svc.unsyncAllForCondominio(1);
    await assentar();

    expect(prisma.pessoas.update).toHaveBeenCalledTimes(1);
    expect(prisma.pessoas.update).toHaveBeenCalledWith({
      where: { id: 2000001 },
      data: { face_sync_status: 'pending' },
    });
    expect((svc as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('0 ok, 1 falha(s) de 1'),
    );
  });
});
