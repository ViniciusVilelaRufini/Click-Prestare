import axios from 'axios';
import * as http from 'http';
import { FacialDeviceClientService, FacialDeviceConfig } from './facial-device-client.service';

/**
 * Pentest P-05: com o agente offline, a API chamava http(s)://<ip>:<porta> do
 * terminal cadastrado direto da nuvem, com redirecionamento padrão e sem
 * barrar rede interna. Qualquer síndico podia cadastrar um "terminal" e varrer
 * a VPC. Agora o caminho nuvem→terminal só alcança endereço público, sem
 * seguir redirecionamento; endereço privado é só pelo Agente Local (ou com a
 * env FACIAL_HTTP_DIRETO_REDE_INTERNA=true, para on-premise/dev).
 */
describe('FacialDeviceClientService — SSRF no modo direto (P-05)', () => {
  const agenteOffline: any = { isOnline: () => false, enqueue: jest.fn() };
  const dev = (ip: string, fabricante = 'hikvision', porta = 80): FacialDeviceConfig => ({
    id: 7,
    ip,
    porta,
    api_user: 'admin',
    api_password: 'x',
    fabricante,
  });
  let request: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.FACIAL_HTTP_DIRETO_REDE_INTERNA;
    request = jest.spyOn(axios, 'request').mockResolvedValue({ status: 200, headers: {}, data: {} } as any);
  });
  afterEach(() => {
    request.mockRestore();
    delete process.env.FACIAL_HTTP_DIRETO_REDE_INTERNA;
  });

  it.each(['10.0.0.5', '172.16.3.4', '192.168.1.10', '127.0.0.1', '169.254.169.254', 'localhost'])(
    'não chama da nuvem um terminal em %s (rede interna)',
    async (ip) => {
      const client = new FacialDeviceClientService(agenteOffline);
      await expect(client.ping(dev(ip))).resolves.toBe(false);
      const r = await client.triggerRelay(dev(ip));
      expect(r.ok).toBe(false);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('Control iD (instância axios própria) também não sai para rede interna', async () => {
    const client = new FacialDeviceClientService(agenteOffline);
    const create = jest.spyOn(axios, 'create');
    await expect(client.ping(dev('10.1.2.3', 'control_id'))).resolves.toBe(false);
    create.mockRestore();
  });

  it('endereço público: sem seguir redirecionamento e com agentes que recusam IP interno', async () => {
    const client = new FacialDeviceClientService(agenteOffline);
    await expect(client.ping(dev('8.8.8.8'))).resolves.toBe(true);
    const cfg = request.mock.calls[0][0];
    expect(cfg.maxRedirects).toBe(0);
    expect(cfg.proxy).toBe(false);
    expect(cfg.httpAgent).toBeInstanceOf(http.Agent);
    expect((cfg.httpAgent as any).options.lookup).toEqual(expect.any(Function));
  });

  it('com FACIAL_HTTP_DIRETO_REDE_INTERNA=true (on-premise/dev) o IP de LAN é alcançado, ainda sem redirect', async () => {
    process.env.FACIAL_HTTP_DIRETO_REDE_INTERNA = 'true';
    const client = new FacialDeviceClientService(agenteOffline);
    await expect(client.ping(dev('192.168.1.10'))).resolves.toBe(true);
    expect(request.mock.calls[0][0].maxRedirects).toBe(0);
  });
});
