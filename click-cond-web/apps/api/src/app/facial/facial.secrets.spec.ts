import { FacialService } from './facial.service';

describe('FacialService public device responses', () => {
  const device = {
    id: 7,
    id_condominio: 1,
    nome: 'Portaria',
    tipo: 'facial',
    sentido: 'auto',
    confianca_minima: 0,
    fabricante: 'intelbras',
    modelo: null,
    ip: '192.0.2.10',
    porta: 80,
    api_user: 'operator',
    api_password: 'test-device-password',
    webhook_token: 'test-webhook-token',
    ativo: 1,
    id_area_social: null,
    created_at: new Date(),
  };

  function buildService() {
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findMany: jest.fn().mockResolvedValue([device]),
        findUnique: jest.fn().mockResolvedValue(device),
        create: jest.fn().mockResolvedValue(device),
        update: jest.fn().mockResolvedValue(device),
      },
      auditoria: { registrar: jest.fn() },
    };
    const agent: any = {
      isOnline: jest.fn().mockReturnValue(true),
      isDeviceOnline: jest.fn().mockReturnValue(true),
    };

    const service = new FacialService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      { registrar: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      agent,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, prisma };
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('omits device passwords and webhook tokens from portal-facing device responses', async () => {
    const { service } = buildService();

    const listed = await service.listDevices(1);
    const found = await service.getDevice(7);
    const created = await service.createDevice({
      id_condominio: 1,
      nome: 'Portaria',
      fabricante: 'intelbras',
      ip: '192.0.2.10',
    });
    const updated = await service.updateDevice(7, { nome: 'Portaria principal' });

    for (const response of [listed[0], found, created, updated]) {
      expect(response).not.toHaveProperty('api_password');
      expect(response).not.toHaveProperty('webhook_token');
    }
  });
});
