/**
 * Áreas sociais — check-in por facial gated por reserva (syncReservaArea).
 * Aprovado → enrola moradores do apto no terminal da área com a janela do
 * horário; sem foto → pula; recusado → remove (a menos que haja outra reserva
 * vigente); área sem reserva obrigatória → não faz nada.
 *
 * Testa o wiring com mocks — sem banco, sem device.
 */
// FACIAL_DISABLED é lido no import; garantimos a integração LIGADA re-importando
// o módulo com a env correta (o .env de dev tem FACIAL_INTEGRATION_ENABLED=false).
let FacialService: any;

describe('FacialService — syncReservaArea (áreas sociais)', () => {
  beforeAll(() => {
    jest.useFakeTimers(); // neutraliza os setInterval do construtor
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => jest.useRealTimers());

  const DEVICE = { id: 9, id_area_social: 3, tipo: 'facial', ativo: 1 };
  const MORADORES = [
    { id: 11, nome: 'Ana', foto_pessoa: 'https://s3/ana.jpg', face_id: 'morador_11', id_condominio: 1 },
    { id: 12, nome: 'Beto', foto_pessoa: null, face_id: null, id_condominio: 1 }, // sem foto
  ];

  function build(agOverrides: Record<string, any> = {}, opts: { outraReserva?: number } = {}) {
    const ag = {
      id: 100,
      id_area_social: 3,
      id_apartamento: 50,
      data: new Date('2026-07-20T00:00:00.000Z'),
      hora_de: new Date('1970-01-01T14:00:00.000Z'),
      hora_ate: new Date('1970-01-01T18:00:00.000Z'),
      status: 'aprovado',
      area: { id_condominio: 1, controle_acesso_facial: 1 },
      ...agOverrides,
    };
    const client = {
      enrollPerson: jest.fn(async () => ({ faceId: 'morador_x' })),
      removePerson: jest.fn(async () => true),
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais_Agendamentos: {
        findUnique: jest.fn(async () => ag),
        count: jest.fn(async () => opts.outraReserva ?? 0),
      },
      facial_Devices: { findMany: jest.fn(async () => [DEVICE]) },
      apartamentos_Users: {
        findMany: jest.fn(async () => [{ id_user: 111 }, { id_user: 112 }]),
      },
      moradores: { findMany: jest.fn(async () => MORADORES) },
    };
    const svc = new FacialService(
      prisma,
      client as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(svc as any, 'fetchPhotoAsBase64').mockResolvedValue('BASE64DATA');
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    return { svc, prisma, client, ag };
  }

  it('aprovado → enrola cada morador COM foto, com a janela do horário e UseTime -1', async () => {
    const { svc, client } = build();
    await svc.syncReservaArea(100);

    // Beto (sem foto) é pulado; só Ana é enrolada.
    expect(client.enrollPerson).toHaveBeenCalledTimes(1);
    expect(client.enrollPerson).toHaveBeenCalledWith(
      DEVICE,
      expect.objectContaining({
        externalId: 'morador_11',
        validFrom: '2026-07-20 14:00:00',
        validTo: '2026-07-20 18:00:00',
        userTimes: -1,
      }),
    );
    expect(client.removePerson).not.toHaveBeenCalled();
  });

  it('recusado (sem outra reserva) → remove os moradores do terminal', async () => {
    const { svc, client } = build({ status: 'recusado' }, { outraReserva: 0 });
    await svc.syncReservaArea(100);
    expect(client.removePerson).toHaveBeenCalledWith(DEVICE, 'morador_11');
    expect(client.enrollPerson).not.toHaveBeenCalled();
  });

  it('recusado MAS com outra reserva vigente → NÃO remove', async () => {
    const { svc, client } = build({ status: 'recusado' }, { outraReserva: 1 });
    await svc.syncReservaArea(100);
    expect(client.removePerson).not.toHaveBeenCalled();
  });

  it('área sem controle de acesso (controle_acesso_facial!=1) → não faz nada', async () => {
    const { svc, client } = build({ area: { id_condominio: 1, controle_acesso_facial: 0 } });
    const res = await svc.syncReservaArea(100);
    expect(res).toEqual(expect.objectContaining({ skipped: true }));
    expect(client.enrollPerson).not.toHaveBeenCalled();
    expect(client.removePerson).not.toHaveBeenCalled();
  });

  it('sem device facial na área → skipped', async () => {
    const { svc, prisma, client } = build();
    prisma.facial_Devices.findMany.mockResolvedValueOnce([]);
    const res = await svc.syncReservaArea(100);
    expect(res).toEqual(expect.objectContaining({ skipped: true, reason: 'no_area_device' }));
    expect(client.enrollPerson).not.toHaveBeenCalled();
  });
});
