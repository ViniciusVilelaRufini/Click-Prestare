/**
 * Lote B — Critical 3: a decisão de porta para um rosto `pessoa_X` caía para
 * `prisma.visitantes.findUnique({ where: { id: idPessoa } })` sempre que a
 * Pessoa não tinha visita ativa — em dois pontos de `runWebhook` (a
 * alternância de direção do terminal "auto" e a checagem final de
 * liberado/janela/dias_semana) e também em `syncVisitante`. `idPessoa` ali é
 * um id de `Pessoas`; resolvê-lo contra `Visitantes` podia acertar o
 * registro de outra pessoa — os dois autoincrement nascem do 1 e crescem em
 * paralelo — e decidir a porta com o cadastro de quem nunca pediu nada.
 *
 * Com a flag ligada, sem visita ativa agora é NEGA (evento 'negado'
 * registrado, mesmo formato das outras negações do webhook) — nunca cai
 * para `Visitantes`.
 *
 * Dormente hoje só porque `Facial_Devices` está vazia em produção — o
 * primeiro terminal facial instalado torna isso ativo.
 */
let FacialService: any;

describe('FacialService — webhook, negação sem visita ativa (Lote B, Critical 3)', () => {
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

  function buildService(prisma: any) {
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
    return { svc, accessState };
  }

  function buildPrisma(opts: { pessoa?: any } = {}) {
    const visitantesDelegate = jest.fn(); // NUNCA deve ser chamado com a flag ON

    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(),
        findMany: jest.fn(async () => []),
      },
      moradores: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
      },
      visitantes: {
        findUnique: visitantesDelegate,
        findFirst: visitantesDelegate,
        findMany: visitantesDelegate,
        update: visitantesDelegate,
        updateMany: visitantesDelegate,
      },
      visitas: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null), // alternância "auto" (Location B) — sem visita ativa
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      pessoas: {
        findUnique: jest.fn(async ({ where, include }: any) => {
          if (!opts.pessoa || where.id !== opts.pessoa.id) return null;
          return include?.visitas ? opts.pessoa : { ...opts.pessoa, visitas: undefined };
        }),
      },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      acessos_Facial: {
        create: jest.fn(async () => ({ id: 1 })),
        findFirst: jest.fn(async () => null),
      },
      vagas: { count: jest.fn(async () => 0) },
      users: { findMany: jest.fn(async () => []) },
    };
    return { prisma, visitantesDelegate };
  }

  const DEVICE_FACIAL_AUTO = {
    id: 3,
    id_condominio: 1,
    tipo: 'facial',
    sentido: 'auto',
    ativo: 1,
    confianca_minima: 0,
    nome: 'Terminal Facial',
    webhook_token: 'tok-facial',
  };

  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });

  it('pessoa existe mas sem nenhuma visita: nega e registra o evento, sem consultar prisma.visitantes', async () => {
    const pessoaSemVisita = {
      id: 77,
      nome: 'Sem Visita',
      tipo_pessoa: 'visitante',
      face_id: 'face-77',
      bloqueado: 0,
      visitas: [],
    };
    const { prisma, visitantesDelegate } = buildPrisma({ pessoa: pessoaSemVisita });
    prisma.facial_Devices.findFirst.mockResolvedValue(DEVICE_FACIAL_AUTO);
    const { svc } = buildService(prisma);

    // Sem `direction` e sem palavra de entrada/saída no `event`: terminal
    // "auto" ambíguo (caso real do Dahua/Intelbras) — exercita a alternância
    // (Location B) E a decisão de porta (Location C) na mesma chamada.
    await expect(
      svc.processWebhook('tok-facial', {
        event: 'access',
        external_id: 'pessoa_77',
        timestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow(/nenhuma visita\/autoriza[cç][aã]o ativa/i);

    expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evento: 'negado',
          id_pessoa: 77,
          tipo_pessoa: 'visitante',
        }),
      }),
    );
    expect(visitantesDelegate).not.toHaveBeenCalled();
  });

  it('pessoa com visita expirada (fora da janela) nega, sem consultar prisma.visitantes', async () => {
    const agora = Date.now();
    const pessoaExpirada = {
      id: 78,
      nome: 'Expirado',
      tipo_pessoa: 'visitante',
      face_id: 'face-78',
      bloqueado: 0,
      visitas: [
        {
          id: 501,
          id_pessoa: 78,
          id_condominio: 1,
          is_prestador: 0,
          liberado: 1,
          bloqueado: 0,
          data_hora_inicio: new Date(agora - 3 * 60 * 60 * 1000),
          data_hora_termino: new Date(agora - 60 * 60 * 1000), // expirou há 1h (fora da GRACE de 15min)
          data_entrada: null,
          data_saida: null,
          dias_semana: null,
        },
      ],
    };
    const { prisma, visitantesDelegate } = buildPrisma({ pessoa: pessoaExpirada });
    prisma.facial_Devices.findFirst.mockResolvedValue(DEVICE_FACIAL_AUTO);
    const { svc } = buildService(prisma);

    await expect(
      svc.processWebhook('tok-facial', {
        event: 'access',
        external_id: 'pessoa_78',
        timestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow(/nenhuma visita\/autoriza[cç][aã]o ativa/i);

    expect(visitantesDelegate).not.toHaveBeenCalled();
  });
});
