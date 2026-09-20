import type { FacialDeviceClientService } from './facial-device-client.service';

let FacialService: any;

describe('FacialService: Sincronização por Pessoa', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  let service: any;

  const mockPrisma: any = {
    pessoas: { findUnique: jest.fn(), update: jest.fn() },
    visitas: { findMany: jest.fn() },
    visitantes: { findUnique: jest.fn() },
    facial_Devices: { findMany: jest.fn().mockResolvedValue([]) },
    vagas: { count: jest.fn().mockResolvedValue(0) },
    isConnected: true,
  };

  // Double tipado contra a superfície real do FacialDeviceClientService — se o
  // cliente real renomear/remover um desses métodos, este mock não compila
  // mais (diferente de um `any` com um método inventado como
  // `createOrUpdatePerson`, que nunca existiu na classe real).
  const mockDeviceClient: jest.Mocked<
    Pick<FacialDeviceClientService, 'enrollPerson' | 'updatePerson' | 'removePerson'>
  > = {
    enrollPerson: jest.fn().mockResolvedValue({ faceId: 'face_dev_1' }),
    updatePerson: jest.fn().mockResolvedValue(undefined),
    removePerson: jest.fn().mockResolvedValue(undefined),
  };

  const mockAgentBridge: any = {
    isDeviceOnline: jest.fn().mockReturnValue(true),
    dispatchCommand: jest.fn().mockResolvedValue({ ok: true }),
  };

  const mockAccessState: any = {};
  const mockConsentimentos: any = {
    autorizouBiometria: jest.fn().mockResolvedValue(true),
  };
  const mockNotifications: any = {};
  const mockTenant: any = {
    assertCondominio: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    service = new FacialService(
      mockPrisma,
      mockDeviceClient,
      mockAgentBridge,
      mockAccessState,
      mockConsentimentos,
      mockNotifications,
      mockTenant,
    );
    jest.clearAllMocks();
  });

  it('deve descarregar pessoa do terminal se ela não tiver nenhuma visita ativa', async () => {
    mockPrisma.pessoas.findUnique.mockResolvedValue({
      id: 10,
      id_condominio: 1,
      nome: 'Rodrigo',
      foto_pessoa: 'http://foto.jpg',
      face_id: 'face_10',
      bloqueado: 0,
      visitas: [], // Sem visitas ativas
    });
    jest.spyOn(service, 'unsyncPessoa').mockResolvedValue(true);

    const res = await service.syncPessoa(10);
    expect(res).toMatchObject({ ok: true, syncState: 'revoked' });
    expect(service.unsyncPessoa).toHaveBeenCalledWith(10, 'face_10', 1, expect.any(Object));
  });

  it('deve sincronizar pessoa no terminal quando tiver visita autorizada ativa', async () => {
    const agora = new Date();
    mockPrisma.pessoas.findUnique.mockResolvedValue({
      id: 20,
      id_condominio: 1,
      nome: 'Rodrigo Ativo',
      foto_pessoa: 'http://foto.jpg',
      face_id: 'face_20',
      bloqueado: 0,
      visitas: [
        {
          id: 55,
          id_pessoa: 20,
          id_condominio: 1,
          liberado: 1,
          bloqueado: 0,
          data_hora_inicio: new Date(agora.getTime() - 10000),
          data_hora_termino: new Date(agora.getTime() + 100000),
        },
      ],
    });
    jest.spyOn(service as any, 'pushPessoaToDevices').mockResolvedValue({ ok: true });

    const res = await service.syncPessoa(20);
    expect(res).toMatchObject({ ok: true });
    expect((service as any).pushPessoaToDevices).toHaveBeenCalled();
  });

  describe('pushPessoaToDevices: chamada real ao FacialDeviceClientService', () => {
    const device = {
      id: 900,
      id_condominio: 1,
      ip: '10.0.0.5',
      porta: 80,
      api_user: 'admin',
      api_password: 'admin',
      fabricante: 'intelbras',
      ativo: 1,
      tipo: 'facial',
    };

    beforeEach(() => {
      mockPrisma.facial_Devices.findMany.mockResolvedValue([device]);
      jest.spyOn(service as any, 'fetchPhotoAsBase64').mockResolvedValue('base64foto');
    });

    it('enrola (enrollPerson) quando a pessoa ainda não tem face_id', async () => {
      const pessoa = {
        id: 30,
        id_condominio: 1,
        nome: 'Sem Face Ainda',
        foto_pessoa: 'http://foto.jpg',
        face_id: null,
        tipo_pessoa: 'visitante',
      };

      const res = await service.pushPessoaToDevices(pessoa);

      expect(mockDeviceClient.enrollPerson).toHaveBeenCalledTimes(1);
      expect(mockDeviceClient.updatePerson).not.toHaveBeenCalled();
      expect(mockDeviceClient.enrollPerson).toHaveBeenCalledWith(
        expect.objectContaining({ id: 900, fabricante: 'intelbras' }),
        expect.objectContaining({
          externalId: 'pessoa_30',
          nome: 'Sem Face Ainda',
          fotoBase64: 'base64foto',
        }),
      );
      expect(res.face_id).toBe('face_dev_1');
      expect(mockPrisma.pessoas.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 30 },
          data: expect.objectContaining({ face_id: 'face_dev_1' }),
        }),
      );
    });

    it('atualiza (updatePerson) quando a pessoa já tem face_id', async () => {
      const pessoa = {
        id: 31,
        id_condominio: 1,
        nome: 'Já Enrolada',
        foto_pessoa: 'http://foto.jpg',
        face_id: 'face_existente',
        tipo_pessoa: 'prestador',
      };

      await service.pushPessoaToDevices(pessoa);

      expect(mockDeviceClient.updatePerson).toHaveBeenCalledTimes(1);
      expect(mockDeviceClient.enrollPerson).not.toHaveBeenCalled();
      expect(mockDeviceClient.updatePerson).toHaveBeenCalledWith(
        expect.objectContaining({ id: 900 }),
        'face_existente',
        expect.objectContaining({ nome: 'Já Enrolada', fotoBase64: 'base64foto' }),
      );
    });

    /**
     * Finding 4: syncVisitante grava validFrom/validTo/userTimes NO
     * APARELHO — o próprio terminal nega sozinho após o término, mesmo
     * offline. pushPessoaToDevices não fazia isso: a pessoa ficava enrolada
     * permanentemente, sem nenhuma janela de expiração no terminal.
     */
    it('envia validFrom/validTo derivados da visita ativa da pessoa (janela no aparelho)', async () => {
      const agora = Date.now();
      const pessoa = {
        id: 40,
        id_condominio: 1,
        nome: 'Com Janela',
        foto_pessoa: 'http://foto.jpg',
        face_id: null,
        tipo_pessoa: 'visitante',
        visitas: [
          {
            id: 77,
            liberado: 1,
            bloqueado: 0,
            data_hora_inicio: new Date(agora - 10_000),
            data_hora_termino: new Date(agora + 100_000),
            data_entrada: null,
            data_saida: null,
            dias_semana: null,
          },
        ],
      };

      await service.pushPessoaToDevices(pessoa);

      expect(mockDeviceClient.enrollPerson).toHaveBeenCalledWith(
        expect.objectContaining({ id: 900 }),
        expect.objectContaining({
          validFrom: expect.any(String),
          validTo: expect.any(String),
          userTimes: 1,
        }),
      );
    });

    it('sem visita ativa, não envia validFrom/validTo (permanece null/undefined)', async () => {
      const pessoa = {
        id: 41,
        id_condominio: 1,
        nome: 'Sem Visita',
        foto_pessoa: 'http://foto.jpg',
        face_id: null,
        tipo_pessoa: 'visitante',
        visitas: [],
      };

      await service.pushPessoaToDevices(pessoa);

      const [, payload] = mockDeviceClient.enrollPerson.mock.calls[0];
      expect(payload.validFrom).toBeUndefined();
      expect(payload.validTo).toBeUndefined();
    });

    it('prestador tem usos ilimitados (userTimes = -1) mesmo com visita ativa', async () => {
      const agora = Date.now();
      const pessoa = {
        id: 42,
        id_condominio: 1,
        nome: 'Prestador Ativo',
        foto_pessoa: 'http://foto.jpg',
        face_id: null,
        tipo_pessoa: 'prestador',
        visitas: [
          {
            id: 78,
            liberado: 1,
            bloqueado: 0,
            data_hora_inicio: new Date(agora - 10_000),
            data_hora_termino: new Date(agora + 100_000),
            data_entrada: null,
            data_saida: null,
            dias_semana: null,
          },
        ],
      };

      await service.pushPessoaToDevices(pessoa);

      expect(mockDeviceClient.enrollPerson).toHaveBeenCalledWith(
        expect.objectContaining({ id: 900 }),
        expect.objectContaining({ userTimes: -1 }),
      );
    });
  });
});
