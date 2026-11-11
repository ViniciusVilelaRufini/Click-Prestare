import { BadRequestException } from '@nestjs/common';
import { FacialService } from './facial.service';
import { motivoIpDispositivoInvalido } from './device-endereco.util';

/**
 * O ip/porta do terminal vira URL na API quando o agente está offline
 * (FacialDeviceClientService.baseUrl). Sem validação, o síndico apontava a
 * API para o metadata da AWS ou para a VPC.
 */
describe('motivoIpDispositivoInvalido', () => {
  it.each([
    '169.254.169.254',
    '169.254.169.254/latest/meta-data/x#',
    '127.0.0.1',
    '0.0.0.0',
    '224.0.0.1',
    'localhost',
    'api.localhost',
    'metadata.google.internal',
    '2130706433',
    '0x7f000001',
    '127.1',
    '192.168.0.300',
    '10.0.0.1?x=1',
    'user@10.0.0.1',
    ' 192.168.0.10',
    '::1',
    '',
  ])('recusa %s', (ip) => expect(motivoIpDispositivoInvalido(ip)).not.toBeNull());

  it.each(['192.168.3.175', '10.0.0.20', '172.16.5.4', '200.150.10.2', 'portaria.condominio.com.br', 'sim', 'simulador'])(
    'aceita %s',
    (ip) => expect(motivoIpDispositivoInvalido(ip)).toBeNull(),
  );
});

describe('FacialService.createDevice / updateDevice — endereço do terminal', () => {
  function build() {
    const device: any = {
      id: 1, id_condominio: 10, nome: 'facial', tipo: 'facial', ativo: 1,
      ip: '192.168.3.175', porta: 80, api_password: null, id_area_social: null,
    };
    const prisma: any = {
      facial_Devices: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data })),
        findUnique: jest.fn(async () => ({ ...device })),
        // Consulta de duplicado (mesmo ip:porta / MAC): nenhum outro dispositivo.
        findFirst: jest.fn(async () => null),
        update: jest.fn(async ({ data }: any) => Object.assign(device, data)),
      },
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new FacialService(
      prisma, null as any, null as any, null as any, auditoria,
      null as any, null as any, null as any, null as any, null as any,
    );
    return { svc, prisma };
  }
  const base = { id_condominio: 10, nome: 'Facial', fabricante: 'intelbras' };

  it('create recusa ip que reescreve a URL para o metadata da AWS', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.createDevice({ ...base, ip: '169.254.169.254/latest/meta-data/x#' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.facial_Devices.create).not.toHaveBeenCalled();
  });

  it('create recusa porta fora de 1-65535', async () => {
    const { svc, prisma } = build();
    await expect(svc.createDevice({ ...base, ip: '192.168.3.175', porta: 70000 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.facial_Devices.create).not.toHaveBeenCalled();
  });

  it('create aceita IP de LAN e normaliza porta numérica', async () => {
    const { svc, prisma } = build();
    await svc.createDevice({ ...base, ip: '192.168.3.175', porta: '8080' as any });
    const data = prisma.facial_Devices.create.mock.calls[0][0].data;
    expect(data.ip).toBe('192.168.3.175');
    expect(data.porta).toBe(8080);
  });

  it('create sem porta continua usando 80', async () => {
    const { svc, prisma } = build();
    await svc.createDevice({ ...base, ip: '10.0.0.20' });
    expect(prisma.facial_Devices.create.mock.calls[0][0].data.porta).toBe(80);
  });

  it('update recusa ip de loopback e não grava', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateDevice(1, { ip: '127.0.0.1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.facial_Devices.update).not.toHaveBeenCalled();
  });

  it('update sem ip/porta no corpo não valida nem mexe neles', async () => {
    const { svc, prisma } = build();
    await svc.updateDevice(1, { nome: 'novo' });
    const data = prisma.facial_Devices.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('ip');
    expect(data).not.toHaveProperty('porta');
  });
});
