import { AgentController } from './agent.controller';
import { FacialService } from './facial.service';

describe('agent secret boundaries', () => {
  const device = {
    id: 7,
    id_condominio: 1,
    nome: 'Portaria',
    tipo: 'facial',
    fabricante: 'intelbras',
    ip: '192.0.2.10',
    porta: 80,
    api_user: 'operator',
    api_password: 'opaque-test-value',
    webhook_token: 'opaque-test-token',
    ativo: 1,
    id_area_social: null,
    created_at: new Date(),
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('omits device credentials from both agent poll response shapes', async () => {
    const service: any = {
      findDeviceByToken: jest.fn().mockResolvedValue(device),
      resolveCondominioForAgent: jest.fn().mockResolvedValue(1),
      getActiveDevices: jest.fn().mockResolvedValue([device]),
      syncAllForCondominio: jest.fn().mockResolvedValue(undefined),
    };
    const bridge: any = {
      isOnline: jest.fn().mockReturnValue(true),
      poll: jest.fn().mockReturnValue([]),
      pollIntervalMs: 2000,
    };
    const controller = new AgentController(service, bridge);

    const singleDevicePoll = await controller.poll('opaque-agent-token');
    const condoPoll = await controller.condoPoll('opaque-agent-token');

    for (const response of [singleDevicePoll.device, condoPoll.devices[0].device]) {
      expect(response).not.toHaveProperty('api_password');
      expect(response).not.toHaveProperty('webhook_token');
    }
  });

  it('does not serialize agent or webhook tokens through tenant-facing provisioning methods', async () => {
    const prisma: any = {
      isConnected: true,
      condominios: {
        findUnique: jest.fn().mockResolvedValue({
          nome: 'Condomínio de teste',
          agent_token: 'opaque-agent-token',
        }),
      },
      facial_Devices: {
        findUnique: jest.fn().mockResolvedValue(device),
        update: jest.fn().mockResolvedValue(device),
      },
    };
    const service = new FacialService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      { registrar: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const info = await service.getAgentInfo(1);
    const envConfig = await service.getAgentConfigFile(1, 'https://api.example.test', 'env');
    const batConfig = await service.getAgentConfigFile(1, 'https://api.example.test', 'bat');
    const rotation = await service.rotateWebhookToken(7);

    expect(info).not.toHaveProperty('agent_token');
    for (const config of [envConfig, batConfig]) {
      expect(config.content).not.toContain('AGENT_TOKEN=');
      expect(config.content).not.toContain('opaque-agent-token');
    }
    expect(rotation).not.toHaveProperty('webhook_token');
  });
});
