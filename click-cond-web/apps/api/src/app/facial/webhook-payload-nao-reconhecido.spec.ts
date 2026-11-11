/**
 * Payload sem NENHUMA credencial (heartbeat, evento de porta, corpo vazio) não
 * é tentativa de acesso: responde 200 "ignorado" e não grava em Acessos_Facial.
 * Antes virava uma linha "negado — Não identificado ou expirado" + 400 e
 * enchia o histórico de ruído.
 *
 * Continua "negado" + 400: credencial presente e desconhecida, e negação
 * explícita informada pelo aparelho.
 *
 * Mocks, sem banco e sem aparelho.
 */
let FacialService: any;

describe('FacialService — payload não reconhecido no webhook', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => {
    jest.useRealTimers();
    delete process.env.PESSOAS_MIGRATION_ENABLED;
  });

  const dispositivo = (tipo: string) => ({
    id: 42,
    id_condominio: 1,
    tipo,
    sentido: 'auto',
    ativo: 1,
    confianca_minima: 0,
    id_area_social: null,
    nome: `Aparelho ${tipo}`,
    webhook_token: 'tok',
  });

  function build(tipo = 'facial', opts: { sessaoDeCaptura?: any } = {}) {
    const nada = { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) };
    const prisma: any = {
      isConnected: true,
      facial_Devices: { findFirst: jest.fn(async () => dispositivo(tipo)), findMany: jest.fn(async () => []) },
      moradores: { ...nada },
      visitantes: { ...nada },
      prestadores_servico: { ...nada },
      tags: { findMany: jest.fn(async () => []) },
      veiculos: { ...nada },
      vagas: { ...nada },
      acessos_Facial: { create: jest.fn(async () => ({ id: 1 })), findFirst: jest.fn(async () => null) },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      users: { findMany: jest.fn(async () => []) },
    };
    const enrollSessions: any = { consumeForDevice: jest.fn(() => opts.sessaoDeCaptura ?? null) };
    const svc = new FacialService(
      prisma,
      { triggerRelay: jest.fn() } as any,
      { sendPushNotification: jest.fn() } as any,
      enrollSessions,
      { registrar: jest.fn() } as any,
      {
        shouldDebounce: jest.fn(() => false),
        checkAntiPassback: jest.fn(() => 'allow'),
        hasPresenca: jest.fn(() => false),
        setPresenca: jest.fn(),
      } as any,
      {} as any,
    );
    return { svc, prisma, enrollSessions };
  }

  // Revisão 11/11: em `debug` um leitor mal configurado (mandando corpo que o
  // conversor não entende) sumia. Avisa em `warn`, uma vez por dispositivo a
  // cada 10 minutos (em memória).
  describe('aviso amostrado de payload sem credencial', () => {
    const avisos = (svc: any) =>
      svc.logger.warn.mock.calls.filter((c: any[]) => /sem credencial/i.test(String(c[0])));
    function comLogger(tipo = 'tag_reader') {
      const r = build(tipo);
      (r.svc as any).logger = { warn: jest.fn(), debug: jest.fn(), log: jest.fn(), error: jest.fn() };
      return r;
    }

    it('avisa em warn na primeira vez e cala as repetições dentro de 10 min', async () => {
      const { svc } = comLogger();

      await svc.processWebhook('tok', {});
      await svc.processWebhook('tok', { event: 'heartbeat' });
      jest.advanceTimersByTime(9 * 60 * 1000);
      await svc.processWebhook('tok', {});

      expect(avisos(svc)).toHaveLength(1);
      expect(avisos(svc)[0][0]).toMatch(/device 42/);
    });

    it('volta a avisar depois de 10 min', async () => {
      const { svc } = comLogger();

      await svc.processWebhook('tok', {});
      jest.advanceTimersByTime(10 * 60 * 1000 + 1);
      await svc.processWebhook('tok', {});

      expect(avisos(svc)).toHaveLength(2);
    });

    it('a amostragem é por dispositivo', async () => {
      const { svc, prisma } = comLogger();

      await svc.processWebhook('tok', {});
      prisma.facial_Devices.findFirst.mockResolvedValue({ ...dispositivo('tag_reader'), id: 43 });
      await svc.processWebhook('tok', {});

      expect(avisos(svc)).toHaveLength(2);
    });
  });

  describe('sem nenhuma credencial: ignora (200) e não grava acesso', () => {
    it.each([
      ['corpo vazio', {}],
      ['heartbeat', { event: 'heartbeat', timestamp: '2026-07-20T10:00:00.000Z' }],
      ['evento de porta nativo (Dahua)', { Events: [{ Code: 'DoorStatus', Data: { Status: 'Open' } }] }],
      ['Hikvision heartBeat em XML', '<EventNotificationAlert><eventType>videoloss</eventType></EventNotificationAlert>'],
      ['credenciais em branco', { external_id: '', card_uid: '  ', qrcode: '' }],
    ])('%s', async (_nome, payload) => {
      const { svc, prisma } = build('facial');

      const res = await svc.processWebhook('tok', payload as any);

      expect(res).toEqual({ ok: true, ignored: 'payload_nao_reconhecido' });
      expect(prisma.acessos_Facial.create).not.toHaveBeenCalled();
    });

    it('vale também para leitor de tag', async () => {
      const { svc, prisma } = build('tag_reader');

      const res = await svc.processWebhook('tok', { event: 'door_open' } as any);

      expect(res).toEqual({ ok: true, ignored: 'payload_nao_reconhecido' });
      expect(prisma.acessos_Facial.create).not.toHaveBeenCalled();
    });
  });

  describe('continua "negado" + 400', () => {
    it('credencial presente e desconhecida (rosto)', async () => {
      const { svc, prisma } = build('facial');

      await expect(
        svc.processWebhook('tok', { external_id: 'morador_999' }),
      ).rejects.toThrow(/Credencial não encontrada/);

      expect(prisma.acessos_Facial.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ evento: 'negado', face_id: 'morador_999', tipo_pessoa: 'desconhecido' }),
      );
    });

    it('tag desconhecida', async () => {
      const { svc, prisma } = build('tag_reader');

      await expect(svc.processWebhook('tok', { card_uid: 'ABC999' })).rejects.toThrow();

      expect(prisma.acessos_Facial.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ evento: 'negado', face_id: 'ABC999' }),
      );
    });

    it('placa enviada a um terminal que não é LPR', async () => {
      const { svc, prisma } = build('facial');

      await expect(svc.processWebhook('tok', { placa: 'ABC1D23' })).rejects.toThrow();

      expect(prisma.acessos_Facial.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ evento: 'negado' }),
      );
    });

    it('negação explícita do aparelho, sem credencial (Control iD user_id 0)', async () => {
      const { svc, prisma } = build('facial');

      await expect(
        svc.processWebhook('tok', {
          object_changes: [{ object: 'access_logs', values: { user_id: 0, time: 1784541600 } }],
        } as any),
      ).rejects.toThrow(/Acesso negado/);

      expect(prisma.acessos_Facial.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ evento: 'negado', tipo_pessoa: 'desconhecido' }),
      );
    });

    it('negação explícita no formato limpo, sem credencial', async () => {
      const { svc, prisma } = build('facial');

      await expect(svc.processWebhook('tok', { event: 'access_denied' })).rejects.toThrow();

      expect(prisma.acessos_Facial.create).toHaveBeenCalledTimes(1);
    });
  });

  it('captura guiada (enroll) não é afetada: tag desconhecida com sessão aberta é capturada', async () => {
    const { svc, prisma, enrollSessions } = build('tag_reader', { sessaoDeCaptura: { id: 'sess-1' } });

    const res = await svc.processWebhook('tok', { card_uid: 'ABC999' });

    expect(res).toEqual({ ok: true, captured: true, sessionId: 'sess-1', value: 'ABC999' });
    expect(enrollSessions.consumeForDevice).toHaveBeenCalledWith(42, 'ABC999');
    expect(prisma.acessos_Facial.create).not.toHaveBeenCalled();
  });
});
