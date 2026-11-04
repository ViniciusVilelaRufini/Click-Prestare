
/**
 * Pentest P-11: no modo "um token por dispositivo" (poll/result do agente e o
 * webhook direto do aparelho), o findFirst filtrava só o dispositivo ativo.
 * Condomínio desligado no CRM continuava recebendo comandos, credenciais dos
 * aparelhos e eventos. Agora os dois caminhos exigem condominio.ativo = 1,
 * como resolveCondominioForAgent já fazia.
 */
let FacialService: any;

describe('FacialService — token de dispositivo exige condomínio ativo (P-11)', () => {
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

  function build() {
    // Simula o banco: o dispositivo está ativo, mas o condomínio está desligado.
    const findFirst = jest.fn(async (args: any) =>
      args?.where?.condominio?.ativo === 1 ? null : { id: 1, id_condominio: 9, ativo: 1, api_password: null },
    );
    const prisma: any = { isConnected: true, facial_Devices: { findFirst } };
    const svc = new FacialService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { svc, findFirst };
  }

  it('findDeviceByToken recusa dispositivo de condomínio desativado', async () => {
    const { svc, findFirst } = build();
    await expect(svc.findDeviceByToken('tok')).rejects.toMatchObject({ status: 401 });
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ webhook_token: 'tok', ativo: 1, condominio: { ativo: 1 } });
  });

  it('processWebhook recusa dispositivo de condomínio desativado', async () => {
    const { svc, findFirst } = build();
    const run = jest.spyOn(svc, 'runWebhook').mockResolvedValue(undefined as any);
    await expect(svc.processWebhook('tok', {} as any)).rejects.toMatchObject({ status: 401 });
    expect(run).not.toHaveBeenCalled();
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ webhook_token: 'tok', ativo: 1, condominio: { ativo: 1 } });
  });
});
