/**
 * LPR — leitura de placa por câmera vira acesso.
 *
 * A placa é casada com o cadastro em duas fontes: Veiculos (carro do morador)
 * e Vagas (liberação temporária, válida só dentro da janela). Placa não
 * encontrada fica registrada como negada, para a portaria avaliar.
 *
 * Não há hardware LPR para testar em campo — estes testes são a verificação
 * do fluxo. Mocks, sem banco e sem câmera.
 */
let FacialService: any;

describe('FacialService — LPR (leitura de placa)', () => {
  beforeAll(() => {
    jest.useFakeTimers(); // neutraliza os setInterval do construtor
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => jest.useRealTimers());

  const DEVICE_LPR = {
    id: 42,
    id_condominio: 1,
    tipo: 'lpr',
    sentido: 'entrada',
    ativo: 1,
    confianca_minima: 0,
    id_area_social: null,
    webhook_token: 'tok-lpr',
  };

  const MORADOR = { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 1 };

  function build(opts: {
    veiculo?: any;
    vaga?: any;
    device?: any;
  } = {}) {
    const device = opts.device ?? DEVICE_LPR;
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => device),
        findMany: jest.fn(async () => []),
      },
      veiculos: { findFirst: jest.fn(async () => opts.veiculo ?? null) },
      vagas: { findFirst: jest.fn(async () => opts.vaga ?? null) },
      acessos_Facial: {
        create: jest.fn(async () => ({ id: 1 })),
        findFirst: jest.fn(async () => null),
      },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      // Sem caminho configurado: o acionamento cai no roteamento por regras.
      // O roteamento por etapa tem cobertura própria em caminho-leitores.spec.
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      moradores: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
      },
      visitantes: {
        findFirst: jest.fn(async () => null),
        // Depois de identificar pela vaga, o fluxo revalida a visita: a placa
        // abrir depende de haver visita vigente, não só de estar na vaga.
        findUnique: jest.fn(async () =>
          opts.vaga?.visitante
            ? {
                ...opts.vaga.visitante,
                data_hora_inicio: new Date('2026-07-20T08:00:00.000Z'),
                data_hora_termino: new Date('2026-07-20T20:00:00.000Z'),
                liberado: 1,
                data_saida: null,
              }
            : null,
        ),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      // Sem presença registrada: o fluxo consulta o último acesso no banco
      // (mockado como null) e segue tratando como entrada.
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const enrollSessions: any = { consumeForDevice: jest.fn(() => null) };
    const svc = new FacialService(
      prisma,
      {} as any,
      { sendPushNotification: jest.fn() } as any,
      enrollSessions,
      { registrar: jest.fn() } as any,
      accessState,
      {} as any,
    );
    return { svc, prisma, accessState, enrollSessions };
  }

  const evento = (placa: string, extra: Record<string, any> = {}) => ({
    event: 'entrada',
    placa,
    timestamp: new Date('2026-07-20T10:00:00.000Z').toISOString(),
    ...extra,
  });

  describe('casamento com o cadastro', () => {
    it('placa de veículo de morador identifica o dono', async () => {
      const { svc, prisma } = build({
        veiculo: { id: 5, placa: 'ABC1D23', morador: MORADOR },
      });

      await svc.processWebhook('tok-lpr', evento('ABC1D23'));

      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tipo_dispositivo: 'lpr',
            tipo_pessoa: 'morador',
            id_pessoa: 11,
            nome_pessoa: 'Ana',
            face_id: 'ABC1D23',
          }),
        }),
      );
    });

    // A placa vem da câmera sem separador e no banco está como o morador
    // digitou; sem normalizar, o casamento falharia.
    it('casa placa com hífen no cadastro e sem hífen na leitura', async () => {
      const { svc, prisma } = build({
        veiculo: { id: 5, placa: 'ABC-1D23', morador: MORADOR },
      });

      await svc.processWebhook('tok-lpr', evento('abc1d23'));

      const variantes = prisma.veiculos.findFirst.mock.calls[0][0].where.placa.in;
      expect(variantes).toEqual(
        expect.arrayContaining(['ABC1D23', 'ABC-1D23']),
      );
      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id_pessoa: 11 }),
        }),
      );
    });

    it('sem veículo, cai para a vaga liberada e usa o titular quando não há visitante', async () => {
      const { svc, prisma } = build({
        vaga: {
          id: 3,
          placa: 'XYZ4E56',
          visitante: null,
          beneficiario: null,
          titular: { id: 77, nome: 'Carlos', tipo: 'morador' },
        },
      });

      await svc.processWebhook('tok-lpr', evento('XYZ4E56'));

      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id_pessoa: 77, nome_pessoa: 'Carlos' }),
        }),
      );
    });

    it('vaga com visitante identifica o visitante', async () => {
      const { svc, prisma } = build({
        vaga: {
          id: 3,
          placa: 'XYZ4E56',
          visitante: { id: 90, nome: 'Entregador', is_prestador: 1 },
          beneficiario: null,
          titular: { id: 77, nome: 'Carlos', tipo: 'morador' },
        },
      });

      await svc.processWebhook('tok-lpr', evento('XYZ4E56'));

      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tipo_pessoa: 'prestador',
            id_pessoa: 90,
          }),
        }),
      );
    });

    // A janela da vaga precisa entrar na consulta: liberação vencida não pode
    // continuar abrindo o portão.
    it('consulta a vaga restrita à janela de validade', async () => {
      const { svc, prisma } = build({});

      await expect(
        svc.processWebhook('tok-lpr', evento('XYZ4E56')),
      ).rejects.toThrow();

      const where = prisma.vagas.findFirst.mock.calls[0][0].where;
      expect(where.ativo).toBe(1);
      expect(where.id_condominio).toBe(1);
      expect(JSON.stringify(where.AND)).toContain('inicio');
      expect(JSON.stringify(where.AND)).toContain('fim');
    });
  });

  describe('placa desconhecida', () => {
    it('registra acesso negado com a placa lida, para a portaria avaliar', async () => {
      const { svc, prisma } = build({});

      await expect(
        svc.processWebhook('tok-lpr', evento('QQQ9Z99')),
      ).rejects.toThrow();

      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            evento: 'negado',
            tipo_pessoa: 'desconhecido',
            face_id: 'QQQ9Z99',
            tipo_dispositivo: 'lpr',
          }),
        }),
      );
    });
  });

  describe('leitura inválida do OCR', () => {
    // A câmera lê o tempo todo, inclusive carro na rua e placa suja. Virar
    // "negado" encheria o histórico de ruído e alertaria a portaria à toa.
    it.each(['AB1', 'ABC12345', '', 'XX'])(
      'ignora em silêncio a leitura "%s" (não registra acesso)',
      async (lixo) => {
        const { svc, prisma } = build({});

        const res = await svc.processWebhook('tok-lpr', evento(lixo));

        expect(res).toEqual({ ok: true, ignored: 'placa_invalida' });
        expect(prisma.acessos_Facial.create).not.toHaveBeenCalled();
        expect(prisma.veiculos.findFirst).not.toHaveBeenCalled();
      },
    );
  });

  describe('isolamento entre tipos de dispositivo', () => {
    // Sem isso, um POST com "placa" num leitor de tag viraria acesso — o campo
    // só pode ser interpretado por câmera LPR.
    it('terminal facial ignora o campo placa', async () => {
      const { svc, prisma } = build({
        device: { ...DEVICE_LPR, tipo: 'facial' },
        veiculo: { id: 5, placa: 'ABC1D23', morador: MORADOR },
      });

      await expect(
        svc.processWebhook('tok-lpr', { event: 'entrada', placa: 'ABC1D23' }),
      ).rejects.toThrow();

      expect(prisma.veiculos.findFirst).not.toHaveBeenCalled();
    });
  });

  /**
   * Ponta a ponta com o corpo CRU que a câmera manda, sem passar pelo nosso
   * formato limpo. É o caminho real de uma instalação: aponta-se a câmera para
   * a URL do webhook e ela posta o formato dela. Antes da camada de payloads
   * nativos, tudo isso era descartado em silêncio (a placa chegava vazia).
   */
  describe('push nativo da câmera (sem integrador no meio)', () => {
    it('ANPR da Hikvision em JSON vira acesso do morador', async () => {
      const { svc, prisma } = build({
        veiculo: { id: 5, placa: 'ABC1D23', morador: MORADOR },
      });

      await svc.processWebhook('tok-lpr', {
        eventType: 'ANPR',
        dateTime: '2026-07-20T10:00:00-03:00',
        ANPR: { licensePlate: 'ABC1D23', country: 'BRA' },
      } as any);

      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tipo_dispositivo: 'lpr',
            id_pessoa: 11,
            face_id: 'ABC1D23',
          }),
        }),
      );
    });

    // XML é o padrão de FÁBRICA da notificação Hikvision — o corpo chega como
    // string (parser text/xml no main.ts), não como objeto.
    it('ANPR da Hikvision em XML vira acesso do morador', async () => {
      const { svc, prisma } = build({
        veiculo: { id: 5, placa: 'ABC1D23', morador: MORADOR },
      });

      await svc.processWebhook(
        'tok-lpr',
        `<?xml version="1.0" encoding="UTF-8"?>
         <EventNotificationAlert>
           <eventType>ANPR</eventType>
           <dateTime>2026-07-20T10:00:00-03:00</dateTime>
           <ANPR><licensePlate>ABC1D23</licensePlate></ANPR>
         </EventNotificationAlert>` as any,
      );

      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id_pessoa: 11, face_id: 'ABC1D23' }),
        }),
      );
    });

    it('evento de trânsito Dahua/Intelbras vira acesso do morador', async () => {
      const { svc, prisma } = build({
        veiculo: { id: 5, placa: 'ABC1D23', morador: MORADOR },
      });

      await svc.processWebhook('tok-lpr', {
        Events: [
          {
            Code: 'TrafficJunction',
            Action: 'Pulse',
            Data: { PlateNumber: 'ABC1D23', UTC: 1755440000 },
          },
        ],
      } as any);

      expect(prisma.acessos_Facial.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ id_pessoa: 11, face_id: 'ABC1D23' }),
        }),
      );
    });

    // Câmera lendo carro que passa na rua: sem placa aproveitável, não pode
    // virar "negado" e poluir o histórico.
    it('evento sem placa legível não vira acesso', async () => {
      const { svc, prisma } = build({
        veiculo: { id: 5, placa: 'ABC1D23', morador: MORADOR },
      });

      const res = await svc.processWebhook('tok-lpr', {
        Events: [{ Code: 'TrafficJunction', Data: { PlateNumber: 'X' } }],
      } as any);

      expect(res).toEqual({ ok: true, ignored: 'placa_invalida' });
      expect(prisma.acessos_Facial.create).not.toHaveBeenCalled();
    });
  });

  describe('carro parado no portão', () => {
    it('aplica o cooldown por placa (câmera relê a mesma placa em rajada)', async () => {
      const { svc, accessState, prisma } = build({
        veiculo: { id: 5, placa: 'ABC1D23', morador: MORADOR },
      });
      accessState.shouldDebounce.mockReturnValueOnce(true);

      const res = await svc.processWebhook('tok-lpr', evento('ABC1D23'));

      expect(res).toEqual({ ok: true, debounced: true });
      expect(accessState.shouldDebounce).toHaveBeenCalledWith(
        42,
        'ABC1D23',
        expect.any(String),
      );
      expect(prisma.acessos_Facial.create).not.toHaveBeenCalled();
    });
  });
});
