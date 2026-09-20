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
    isConnected: true,
  };

  const mockDeviceClient: any = {
    createOrUpdatePerson: jest.fn().mockResolvedValue({ ok: true, face_id: 'face_dev_1' }),
    removePerson: jest.fn().mockResolvedValue(true),
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
});
