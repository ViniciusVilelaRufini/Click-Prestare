/**
 * Abertura interna de dispositivo decidida pela nuvem (QR dinâmico validado,
 * passe do entregador). Diferente da rota manual `triggerDevice`, aciona
 * qualquer tipo de aparelho, inclusive o terminal facial, e nunca lança.
 *
 * Mocks, sem banco e sem aparelho.
 */
let FacialService: any;

describe('FacialService.abrirDispositivoInterno', () => {
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

  const aparelho = (tipo: string, extra: any = {}) => ({
    id: 20,
    id_condominio: 1,
    tipo,
    ativo: 1,
    nome: `Aparelho ${tipo}`,
    ip: '10.0.0.5',
    porta: 80,
    api_user: 'admin',
    api_password: 'x',
    fabricante: 'intelbras',
    id_area_social: null,
    ...extra,
  });

  function build(device: any, relay: () => Promise<any> = async () => ({ ok: true, statusCode: 200 })) {
    const acessos: any[] = [];
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async ({ where }: any) =>
          device && where.id === device.id && (where.ativo === undefined || where.ativo === device.ativo) ? device : null,
        ),
        findUnique: jest.fn(async ({ where }: any) => (device && where.id === device.id ? device : null)),
      },
      areas_Sociais: { findMany: jest.fn(async () => []) },
      acessos_Facial: {
        create: jest.fn(async ({ data }: any) => {
          acessos.push(data);
          return { id: acessos.length };
        }),
      },
    };
    const client: any = { triggerRelay: jest.fn(relay) };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new FacialService(
      prisma,
      client,
      { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn(() => null) } as any,
      auditoria,
      {} as any,
      {} as any,
    );
    (svc as any).logger = { warn: jest.fn(), debug: jest.fn(), log: jest.fn(), error: jest.fn() };
    return { svc, prisma, client, acessos };
  }

  const ctx = {
    origem: 'credencial_qr' as const,
    tipoPessoa: 'morador',
    idPessoa: 11,
    nomePessoa: 'Ana',
    credencial: 'cred:7',
  };

  it.each(['botoeira', 'catraca', 'facial'])(
    'aciona %s e grava acionado_auto com face_id = credencial',
    async (tipo) => {
      const device = aparelho(tipo);
      const { svc, client, acessos } = build(device);

      const r = await svc.abrirDispositivoInterno(20, ctx);

      expect(r).toEqual({ ok: true });
      expect(client.triggerRelay).toHaveBeenCalledTimes(1);
      expect(client.triggerRelay.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 20, ip: '10.0.0.5' }));
      expect(acessos).toEqual([
        expect.objectContaining({
          id_condominio: 1,
          id_device: 20,
          tipo_dispositivo: tipo,
          face_id: 'cred:7',
          tipo_pessoa: 'morador',
          id_pessoa: 11,
          nome_pessoa: 'Ana',
          evento: 'acionado_auto',
        }),
      ]);
    },
  );

  it('sem credencial, face_id é a origem', async () => {
    const { svc, acessos } = build(aparelho('botoeira'));

    await svc.abrirDispositivoInterno(20, {
      origem: 'delivery_portao',
      tipoPessoa: 'entregador',
      nomePessoa: 'Entregador iFood',
    });

    expect(acessos[0]).toEqual(
      expect.objectContaining({ face_id: 'delivery_portao', tipo_pessoa: 'entregador', id_pessoa: null, evento: 'acionado_auto' }),
    );
  });

  it('acionamento que devolve ok:false grava falha_acionamento e devolve { ok:false, erro }', async () => {
    const comErro = build(aparelho('botoeira'), async () => ({ ok: false, error: 'Agente offline' }));
    expect(await comErro.svc.abrirDispositivoInterno(20, ctx)).toEqual({ ok: false, erro: 'Agente offline' });
    expect(comErro.acessos).toEqual([
      expect.objectContaining({
        evento: 'falha_acionamento',
        face_id: 'cred:7',
        nome_pessoa: 'Ana (FALHA ao acionar Aparelho botoeira)',
      }),
    ]);

    const soStatus = build(aparelho('catraca'), async () => ({ ok: false, statusCode: 503 }));
    expect(await soStatus.svc.abrirDispositivoInterno(20, ctx)).toEqual({ ok: false, erro: 'HTTP 503' });
    expect(soStatus.acessos[0].evento).toBe('falha_acionamento');
  });

  it('acionamento que lança não propaga: devolve { ok:false, erro } e grava falha_acionamento', async () => {
    const { svc, acessos } = build(aparelho('facial'), async () => {
      throw new Error('socket hang up');
    });

    const r = await svc.abrirDispositivoInterno(20, ctx);

    expect(r).toEqual({ ok: false, erro: 'socket hang up' });
    expect(acessos).toEqual([
      expect.objectContaining({ evento: 'falha_acionamento', nome_pessoa: 'Ana (FALHA ao acionar Aparelho facial)' }),
    ]);
  });

  it('falha ao gravar o evento também não propaga', async () => {
    const { svc, prisma } = build(aparelho('botoeira'));
    prisma.acessos_Facial.create.mockRejectedValueOnce(new Error('banco fora'));

    await expect(svc.abrirDispositivoInterno(20, ctx)).resolves.toEqual({ ok: true });
  });

  it('aparelho inexistente ou inativo devolve dispositivo_indisponivel sem acionar nem gravar', async () => {
    const inexistente = build(null);
    expect(await inexistente.svc.abrirDispositivoInterno(20, ctx)).toEqual({ ok: false, erro: 'dispositivo_indisponivel' });
    expect(inexistente.client.triggerRelay).not.toHaveBeenCalled();
    expect(inexistente.acessos).toHaveLength(0);

    const inativo = build(aparelho('botoeira', { ativo: 0 }));
    expect(await inativo.svc.abrirDispositivoInterno(20, ctx)).toEqual({ ok: false, erro: 'dispositivo_indisponivel' });
    expect(inativo.client.triggerRelay).not.toHaveBeenCalled();
    expect(inativo.acessos).toHaveLength(0);
    expect(inativo.prisma.facial_Devices.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 20, ativo: 1 } }),
    );
  });

  it('triggerDevice (rota manual) continua recusando aparelho do tipo facial', async () => {
    const { svc, client, acessos } = build(aparelho('facial'));

    await expect(svc.triggerDevice(20, { sub: 1, nome: 'Porteiro' })).rejects.toThrow(
      /Apenas dispositivos do tipo Botoeira ou Catraca/,
    );
    expect(client.triggerRelay).not.toHaveBeenCalled();
    expect(acessos).toHaveLength(0);
  });
});
