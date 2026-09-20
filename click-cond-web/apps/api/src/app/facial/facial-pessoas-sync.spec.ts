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
      const agora = Date.now();
      const pessoa = {
        id: 30,
        id_condominio: 1,
        nome: 'Sem Face Ainda',
        foto_pessoa: 'http://foto.jpg',
        face_id: null,
        tipo_pessoa: 'visitante',
        // Visita ativa dentro da janela: em produção pushPessoaToDevices só
        // é chamado depois que syncPessoa já confirmou `autorizado`, então
        // sempre há uma visita assim por trás — sem ela (ver teste "sem
        // visita ativa" abaixo) a pessoa é removida, não enrolada.
        visitas: [
          {
            id: 60,
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
      const agora = Date.now();
      const pessoa = {
        id: 31,
        id_condominio: 1,
        nome: 'Já Enrolada',
        foto_pessoa: 'http://foto.jpg',
        face_id: 'face_existente',
        tipo_pessoa: 'prestador',
        visitas: [
          {
            id: 61,
            liberado: 1,
            bloqueado: 0,
            is_prestador: 1,
            data_hora_inicio: new Date(agora - 10_000),
            data_hora_termino: new Date(agora + 100_000),
            data_entrada: null,
            data_saida: null,
            dias_semana: null,
          },
        ],
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

    /**
     * Sem visita ativa nenhuma, a pessoa não devia estar sendo sincronizada
     * (em produção syncPessoa só chega aqui com `autorizado` true). Por
     * segurança o filtro de dispositivo (Regressão 1) trata esse caso como
     * "não pode estar em nenhum terminal": remove em vez de enrolar sem
     * nenhum limite de tempo.
     */
    it('sem visita ativa, remove a pessoa do terminal em vez de enrolar sem janela', async () => {
      const pessoa = {
        id: 41,
        id_condominio: 1,
        nome: 'Sem Visita',
        foto_pessoa: 'http://foto.jpg',
        face_id: 'face_pre_existente',
        tipo_pessoa: 'visitante',
        visitas: [],
      };

      await service.pushPessoaToDevices(pessoa);

      expect(mockDeviceClient.removePerson).toHaveBeenCalledWith(
        expect.objectContaining({ id: 900 }),
        'face_pre_existente',
      );
      expect(mockDeviceClient.enrollPerson).not.toHaveBeenCalled();
      expect(mockDeviceClient.updatePerson).not.toHaveBeenCalled();
    });

    it('prestador tem usos ilimitados (userTimes = -1) quando a VISITA ativa é de prestador', async () => {
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
            is_prestador: 1,
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

    /**
     * Regressão 2: userTimes tinha que ler `Visitas.is_prestador` (a
     * AUTORIZAÇÃO ativa), não `Pessoas.tipo_pessoa` (a IDENTIDADE). Do jeito
     * que estava, qualquer pessoa cadastrada uma vez como 'prestador' ganhava
     * usos ilimitados em TODA visita futura, mesmo criada com is_prestador=0.
     */
    it('regressão 2: pessoa com tipo_pessoa=prestador mas visita ativa is_prestador=0 NÃO tem usos ilimitados', async () => {
      const agora = Date.now();
      const pessoa = {
        id: 43,
        id_condominio: 1,
        nome: 'Ex-Prestador Visitando',
        foto_pessoa: 'http://foto.jpg',
        face_id: null,
        tipo_pessoa: 'prestador', // identidade antiga — não deve mandar
        visitas: [
          {
            id: 79,
            liberado: 1,
            bloqueado: 0,
            is_prestador: 0, // esta visita NÃO é de prestador
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
        expect.anything(),
      );
      const [, payload] = mockDeviceClient.enrollPerson.mock.calls[0];
      expect(payload.userTimes).not.toBe(-1);
    });

    /**
     * Regressão 1: o branch "dentroDoCondominio && !dentroJanela → sem
     * validTo" só é seguro no leitor de SAÍDA (mesmo filtro de
     * `syncVisitante`, facial.service.ts:1895-1910). Sem portar esse filtro,
     * uma pessoa expirada mas ainda dentro do condomínio ficava enrolada
     * SEM NENHUM LIMITE DE TEMPO em TODO terminal, inclusive o de ENTRADA.
     */
    it('regressão 1: pessoa expirada dentro do condomínio não recebe enrollment sem limite no terminal de ENTRADA', async () => {
      const agora = Date.now();
      const entradaDevice = { ...device, id: 901, sentido: 'entrada' };
      const saidaDevice = { ...device, id: 902, sentido: 'saida' };
      mockPrisma.facial_Devices.findMany.mockResolvedValue([entradaDevice, saidaDevice]);

      const pessoa = {
        id: 44,
        id_condominio: 1,
        nome: 'Expirado Dentro',
        foto_pessoa: 'http://foto.jpg',
        face_id: null,
        tipo_pessoa: 'visitante',
        visitas: [
          {
            id: 80,
            liberado: 1,
            bloqueado: 0,
            // Janela já expirada há muito (fora da GRACE de 15min)...
            data_hora_inicio: new Date(agora - 3 * 60 * 60 * 1000),
            data_hora_termino: new Date(agora - 60 * 60 * 1000),
            // ...mas a pessoa ainda está DENTRO do condomínio (sem saída registrada).
            data_entrada: new Date(agora - 2 * 60 * 60 * 1000),
            data_saida: null,
            dias_semana: null,
          },
        ],
      };

      await service.pushPessoaToDevices(pessoa);

      // Terminal de ENTRADA: recusado — removido, nunca enrolado sem prazo.
      expect(mockDeviceClient.removePerson).toHaveBeenCalledWith(
        expect.objectContaining({ id: 901 }),
        expect.any(String),
      );
      expect(mockDeviceClient.enrollPerson).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 901 }),
        expect.anything(),
      );

      // Terminal de SAÍDA: continua liberado (pessoa tem que poder sair),
      // sem validTo — é o único lugar onde isso é seguro.
      expect(mockDeviceClient.enrollPerson).toHaveBeenCalledWith(
        expect.objectContaining({ id: 902 }),
        expect.objectContaining({ validTo: undefined }),
      );
    });
  });
});
