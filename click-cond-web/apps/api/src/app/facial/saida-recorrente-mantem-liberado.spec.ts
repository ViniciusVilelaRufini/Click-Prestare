/**
 * Visitante recorrente (dias da semana) perdia o acesso na 1ª saída pelo
 * terminal: o webhook de saída zerava `liberado` de todo não-prestador sem
 * vaga, e o rosto saía do aparelho. Decisão: visita com `dias_semana` mantém
 * `liberado` na saída, como o prestador (mesma regra do check-out manual).
 */
let FacialService: any;

describe('FacialService — saída do visitante recorrente mantém a liberação', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => {
    jest.useRealTimers();
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });

  const DEVICE_TAG = {
    id: 1, id_condominio: 1, tipo: 'tag_reader', sentido: 'saida', ativo: 1,
    confianca_minima: 0, nome: 'Leitor Tag', webhook_token: 'tok-tag',
  };

  function montar(diasSemana: string | null) {
    const agora = Date.now();
    const visitaDentro = {
      id: 802, id_pessoa: 55, id_condominio: 1, id_apartamento: 101, is_prestador: 0,
      liberado: 1, bloqueado: 0, tag_rfid: 'TAG-REC', codigo_acesso: null,
      data_hora_inicio: new Date(agora - 3_600_000), data_hora_termino: new Date(agora + 30 * 24 * 3_600_000),
      data_entrada: new Date(agora - 1_800_000), data_saida: null, dias_semana: diasSemana,
      pessoa: { id: 55, nome: 'Fulano Recorrente', bloqueado: 0 },
    };
    const pessoa = { id: 55, nome: 'Fulano Recorrente', bloqueado: 0, tipo_pessoa: 'visitante', visitas: [visitaDentro] };
    const prisma: any = {
      isConnected: true,
      facial_Devices: { findFirst: jest.fn(async () => DEVICE_TAG), findMany: jest.fn(async () => []) },
      moradores: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
      tags: { findMany: jest.fn(async () => []) },
      visitantes: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      visitas: {
        findMany: jest.fn(async () => [visitaDentro]),
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      pessoas: {
        findUnique: jest.fn(async ({ where, include }: any) =>
          where.id !== 55 ? null : include?.visitas ? pessoa : { ...pessoa, visitas: undefined },
        ),
      },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      acessos_Facial: { create: jest.fn(async () => ({ id: 1 })), findFirst: jest.fn(async () => null) },
      vagas: { count: jest.fn(async () => 0) },
      users: { findMany: jest.fn(async () => []) },
    };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const svc = new FacialService(
      prisma, {} as any, { sendPushNotification: jest.fn() } as any, { consumeForDevice: jest.fn(() => null) } as any,
      { registrar: jest.fn() } as any, accessState, {} as any,
    );
    return { svc, prisma };
  }

  const saida = { event: 'saida', external_id: 'TAG-REC', timestamp: new Date().toISOString() };

  it('com dias da semana: sai e continua liberado', async () => {
    const { svc, prisma } = montar('seg,ter,qua,qui,sex,sab,dom');
    await svc.processWebhook('tok-tag', { ...saida, timestamp: new Date().toISOString() });
    const chamada = prisma.visitas.updateMany.mock.calls.find((c: any[]) => c[0].where?.id === 802);
    expect(chamada[0].data.liberado).toBe(1);
  });

  it('avulso: sai e perde a liberação', async () => {
    const { svc, prisma } = montar(null);
    await svc.processWebhook('tok-tag', { ...saida, timestamp: new Date().toISOString() });
    const chamada = prisma.visitas.updateMany.mock.calls.find((c: any[]) => c[0].where?.id === 802);
    expect(chamada[0].data.liberado).toBe(0);
  });
});
