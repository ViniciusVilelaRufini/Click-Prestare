/**
 * Varredura de fantasmas biométricos — o único ponto do sistema que APAGA
 * biometria de um aparelho sozinho, de hora em hora, sem ninguém pedir.
 *
 * Dois erros aqui são graves e simétricos:
 *   - varrer de menos → rosto excluído continua abrindo a porta;
 *   - varrer demais   → apaga quem não devia (morador legítimo, ou o usuário
 *     que o instalador criou no aparelho).
 *
 * Mocks, sem banco e sem aparelho.
 */
let FacialService: any;

describe('FacialService — varredura de fantasmas', () => {
  beforeAll(() => {
    jest.useFakeTimers(); // neutraliza os setInterval/setTimeout do construtor
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => jest.useRealTimers());

  const DEVICE = (fabricante: string) => ({
    id: 7,
    id_condominio: 1,
    nome: `Terminal ${fabricante}`,
    tipo: 'facial',
    fabricante,
    ativo: 1,
    ip: '10.0.0.9',
    porta: 80,
    api_user: 'admin',
    api_password: 'x',
  });

  function build(opts: {
    devices: any[];
    idsNoAparelho: string[];
    moradores?: string[];
    visitantes?: string[];
    prestadores?: string[];
  }) {
    const prisma: any = {
      isConnected: true,
      facial_Devices: { findMany: jest.fn(async () => opts.devices) },
      moradores: {
        findMany: jest.fn(async () => (opts.moradores ?? []).map((face_id) => ({ face_id }))),
      },
      visitantes: {
        findMany: jest.fn(async () => (opts.visitantes ?? []).map((face_id) => ({ face_id }))),
      },
      prestadores_servico: {
        findMany: jest.fn(async () => (opts.prestadores ?? []).map((face_id) => ({ face_id }))),
      },
    };
    const client: any = {
      listUserIds: jest.fn(async () => opts.idsNoAparelho),
      removeUsers: jest.fn(async () => undefined),
    };
    const auditoria = { registrar: jest.fn(async () => undefined) };
    const svc = new FacialService(
      prisma,
      client,
      { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn() } as any,
      auditoria as any,
      { shouldDebounce: jest.fn(() => false) } as any,
      { isOnline: jest.fn(() => true) } as any,
    );
    return { svc, prisma, client, auditoria };
  }

  // Chama o método privado: é agendado por timer, não exposto por rota.
  const varrer = (svc: any) => svc.tickFantasmas();

  it('remove o rosto que não está mais em nenhuma das três fontes', async () => {
    const { svc, client } = build({
      devices: [DEVICE('intelbras')],
      idsNoAparelho: ['morador_1', 'visitante_2', 'prestador_servico_3', 'morador_99'],
      moradores: ['morador_1'],
      visitantes: ['visitante_2'],
      prestadores: ['prestador_servico_3'],
    });

    await varrer(svc);

    expect(client.removeUsers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      ['morador_99'],
    );
  });

  // Sem a fonte de prestadores no cálculo, TODO funcionário legítimo seria
  // tratado como fantasma e apagado do aparelho.
  it('não apaga prestador legítimo', async () => {
    const { svc, client } = build({
      devices: [DEVICE('intelbras')],
      idsNoAparelho: ['prestador_servico_3'],
      prestadores: ['prestador_servico_3'],
    });

    await varrer(svc);

    expect(client.removeUsers).not.toHaveBeenCalled();
  });

  // O motivo da varredura existir: o unsync do delete não alcançou o aparelho
  // (agente/terminal offline no instante da exclusão).
  it.each(['hikvision', 'control_id', 'dahua'])(
    'cobre a marca %s (rosto excluído pararia de abrir a porta)',
    async (fabricante) => {
      const { svc, client, prisma } = build({
        devices: [DEVICE(fabricante)],
        idsNoAparelho: ['morador_1', '4242'],
        moradores: ['morador_1'],
      });

      await varrer(svc);

      // A consulta precisa incluir a marca, senão o device nem é varrido.
      const where = prisma.facial_Devices.findMany.mock.calls[0][0].where;
      expect(where.fabricante.in).toContain(fabricante);
      expect(client.removeUsers).toHaveBeenCalledWith(expect.anything(), ['4242']);
    },
  );

  it('não varre marcas que não sabem listar pessoas', async () => {
    const { svc, prisma } = build({ devices: [], idsNoAparelho: [] });

    await varrer(svc);

    const where = prisma.facial_Devices.findMany.mock.calls[0][0].where;
    for (const semHttp of ['zkteco', 'topdata', 'henry']) {
      expect(where.fabricante.in).not.toContain(semHttp);
    }
  });

  it('não chama remoção quando não há fantasma', async () => {
    const { svc, client, auditoria } = build({
      devices: [DEVICE('hikvision')],
      idsNoAparelho: ['morador_1'],
      moradores: ['morador_1'],
    });

    await varrer(svc);

    expect(client.removeUsers).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  // Aparelho inalcançável no momento da varredura não pode derrubar a varredura
  // dos outros terminais do parque.
  it('falha em um device não impede a varredura do seguinte', async () => {
    const { svc, client } = build({
      devices: [{ ...DEVICE('hikvision'), id: 1 }, { ...DEVICE('intelbras'), id: 2 }],
      idsNoAparelho: ['morador_99'],
    });
    client.listUserIds
      .mockRejectedValueOnce(new Error('aparelho offline'))
      .mockResolvedValueOnce(['morador_99']);

    await varrer(svc);

    expect(client.removeUsers).toHaveBeenCalledTimes(1);
    expect(client.removeUsers).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
      ['morador_99'],
    );
  });

  // Aparelho que devolve lista vazia (ou falhou por dentro) não pode ser lido
  // como "não há ninguém cadastrado" — não há o que varrer.
  it('lista vazia não dispara remoção', async () => {
    const { svc, client } = build({
      devices: [DEVICE('control_id')],
      idsNoAparelho: [],
      moradores: ['morador_1'],
    });

    await varrer(svc);

    expect(client.removeUsers).not.toHaveBeenCalled();
  });

  it('registra a remoção na auditoria', async () => {
    const { svc, auditoria } = build({
      devices: [DEVICE('hikvision')],
      idsNoAparelho: ['morador_99'],
    });

    await varrer(svc);

    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        acao: 'FANTASMAS_REMOVIDOS',
        id_condominio: 1,
        detalhes: expect.objectContaining({ count: 1 }),
      }),
    );
  });
});
