/**
 * Caminho de leitores — roteamento do acionamento por etapa.
 *
 * Cenário que motivou o recurso: portão da rua abre por LPR e, já dentro, um
 * terminal facial libera o portão interno. Sem o caminho, o comportamento
 * legado (leitor identificou → aciona TODAS as aberturas) abriria os dois de
 * uma vez na primeira leitura.
 */
let FacialService: any;

describe('FacialService — caminho de leitores (roteamento)', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => jest.useRealTimers());

  const LEITOR_LPR = {
    id: 10,
    id_condominio: 1,
    tipo: 'lpr',
    sentido: 'entrada',
    ativo: 1,
    confianca_minima: 0,
    nome: 'LPR Rua',
    webhook_token: 'tok',
  };
  const PORTAO_RUA = { id: 20, id_condominio: 1, tipo: 'botoeira', ativo: 1, nome: 'Portão Rua' };
  const PORTAO_INTERNO = { id: 21, id_condominio: 1, tipo: 'botoeira', ativo: 1, nome: 'Portão Interno' };
  const MORADOR = { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 1 };

  function build(opts: { etapa?: any } = {}) {
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => LEITOR_LPR),
        // Fallback legado: todas as aberturas do condomínio.
        findMany: jest.fn(async () => [PORTAO_RUA, PORTAO_INTERNO]),
      },
      caminhos_Etapas: { findFirst: jest.fn(async () => opts.etapa ?? null) },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      veiculos: {
        findFirst: jest.fn(async () => ({ id: 5, placa: 'ABC1D23', morador: MORADOR })),
      },
      vagas: { findFirst: jest.fn(async () => null) },
      acessos_Facial: {
        create: jest.fn(async () => ({ id: 1 })),
        findFirst: jest.fn(async () => null),
      },
      moradores: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
      visitantes: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const client: any = { triggerRelay: jest.fn(async () => ({ ok: true })) };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const svc = new FacialService(
      prisma,
      client,
      { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn(() => null) } as any,
      { registrar: jest.fn() } as any,
      accessState,
      {} as any,
    );
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    return { svc, prisma, client };
  }

  const leitura = {
    event: 'entrada',
    placa: 'ABC1D23',
    timestamp: new Date('2026-07-20T10:00:00.000Z').toISOString(),
  };

  it('etapa do caminho aciona SOMENTE a abertura dela', async () => {
    const { svc, client } = build({
      etapa: {
        id: 1,
        ordem: 1,
        id_leitor: 10,
        abertura: PORTAO_RUA,
        caminho: { nome: 'Entrada de veículos' },
      },
    });

    await svc.processWebhook('tok', leitura);

    expect(client.triggerRelay).toHaveBeenCalledTimes(1);
    expect(client.triggerRelay).toHaveBeenCalledWith(
      expect.objectContaining({ id: 20 }),
    );
  });

  // Sem caminho, o comportamento legado continua: abre tudo. É o contraste que
  // mostra por que o caminho existe.
  it('sem caminho, mantém o fallback que aciona todas as aberturas', async () => {
    const { svc, client } = build({ etapa: null });

    await svc.processWebhook('tok', leitura);

    expect(client.triggerRelay).toHaveBeenCalledTimes(2);
  });

  it('etapa sem abertura não aciona nada (não cai no fallback)', async () => {
    const { svc, client } = build({
      etapa: {
        id: 1,
        ordem: 2,
        id_leitor: 10,
        abertura: null,
        caminho: { nome: 'Entrada de veículos' },
      },
    });

    await svc.processWebhook('tok', leitura);

    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  // Aparelho desativado não deve virar "abre tudo": é melhor não abrir nada e
  // o operador ver a pendência no console.
  it('etapa com abertura desativada não aciona nada', async () => {
    const { svc, client } = build({
      etapa: {
        id: 1,
        ordem: 1,
        id_leitor: 10,
        abertura: { ...PORTAO_RUA, ativo: 0 },
        caminho: { nome: 'Entrada de veículos' },
      },
    });

    await svc.processWebhook('tok', leitura);

    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('consulta a etapa apenas em caminho ATIVO do mesmo condomínio', async () => {
    const { svc, prisma } = build({ etapa: null });

    await svc.processWebhook('tok', leitura);

    const where = prisma.caminhos_Etapas.findFirst.mock.calls[0][0].where;
    expect(where.id_leitor).toBe(10);
    expect(where.caminho).toEqual({ id_condominio: 1, ativo: 1 });
  });
});
