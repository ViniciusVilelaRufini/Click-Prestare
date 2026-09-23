/**
 * Entrada reconhecida pelo ROSTO (modelo Pessoas/Visitas): o `v` montado a
 * partir da visita ativa não levava `id_apartamento`. A busca de quem avisar
 * virava `apartamentosUsers: { some: { id_apto: undefined } }` — o Prisma
 * ignora filtro undefined, então o push "Fulano entrou no condomínio" saía
 * para TODO usuário com apartamento e token, de qualquer condomínio.
 */
let FacialService: any;

describe('FacialService — push de entrada pelo facial vai só para o apartamento visitado', () => {
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

  it('entrada por rosto filtra os moradores pelo apartamento da visita', async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const agora = Date.now();
    const visita = {
      id: 1000001,
      id_pessoa: 2000001,
      id_condominio: 1,
      id_apartamento: 106,
      is_visitante: 1,
      is_prestador: 0,
      liberado: 1,
      bloqueado: 0,
      codigo_acesso: null,
      data_entrada: null,
      data_saida: null,
      data_hora_inicio: new Date(agora - 60 * 60 * 1000),
      data_hora_termino: new Date(agora + 60 * 60 * 1000),
      dias_semana: null,
      auth_status: 'autorizado',
      created_at: new Date(agora - 60 * 60 * 1000),
    };
    const pessoa = {
      id: 2000001,
      id_condominio: 1,
      nome: 'QA_SECURITY_20260923_Visitante',
      tipo_pessoa: 'visitante',
      face_id: 'pessoa_2000001',
      bloqueado: 0,
      visitas: [visita],
    };
    const qualquer = () => jest.fn(async () => null);
    const prisma: any = new Proxy(
      {
        isConnected: true,
        facial_Devices: {
          findFirst: jest.fn(async () => ({
            id: 3, id_condominio: 1, tipo: 'facial', sentido: 'entrada', ativo: 1,
            confianca_minima: 0, nome: 'facial principal', webhook_token: 'tok',
          })),
          findMany: jest.fn(async () => []),
        },
        pessoas: {
          findFirst: jest.fn(async () => pessoa),
          findUnique: jest.fn(async () => pessoa),
          update: jest.fn(async () => pessoa),
        },
        visitas: {
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => [visita]),
          update: jest.fn(async ({ data }: any) => ({ ...visita, ...data })),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        users: { findMany: jest.fn(async () => [{ fcm_token: 'tok-morador-106' }]) },
        acessos_Facial: { create: jest.fn(async () => ({ id: 1 })), findFirst: jest.fn(async () => null) },
        regras_Acesso: { findMany: jest.fn(async () => []) },
        caminhos_Etapas: { findFirst: jest.fn(async () => null) },
        vagas: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
      },
      {
        get: (alvo: any, prop) =>
          prop in alvo
            ? alvo[prop]
            : new Proxy({}, { get: () => qualquer() }),
      },
    );
    const notifications = { sendPushNotification: jest.fn(async () => undefined) };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const svc = new FacialService(
      prisma, {} as any, notifications as any, { consumeForDevice: jest.fn(() => null) } as any,
      { registrar: jest.fn() } as any, accessState, {} as any,
    );

    await svc.processWebhook('tok', {
      event: 'entrada',
      direction: 'in',
      external_id: 'pessoa_2000001',
      timestamp: new Date(agora).toISOString(),
    }).catch(() => undefined);

    expect(prisma.users.findMany).toHaveBeenCalled();
    const filtro = prisma.users.findMany.mock.calls[0][0].where.apartamentosUsers.some;
    expect(filtro.id_apto).toBe(106);
  });
});
