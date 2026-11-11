import axios from 'axios';
import { FacialDeviceClientService, FacialDeviceConfig } from './facial-device-client.service';

/**
 * "Testar conexão" só dizia online/offline: o agente devolve { ok, statusCode }
 * e o ping jogava o statusCode fora. diagnosticar() diz POR QUE falhou (senha
 * errada, aparelho mudo, marca errada, agente fora do ar) sem vazar a senha.
 */
describe('FacialDeviceClientService.diagnosticar', () => {
  const SENHA = 'S3nh@-Secreta!';
  const dev = (o: Partial<FacialDeviceConfig> = {}): FacialDeviceConfig => ({
    id: 7,
    ip: '192.168.1.50',
    porta: 80,
    api_user: 'admin',
    api_password: SENHA,
    fabricante: 'intelbras',
    ...o,
  });
  const agenteOnline = (resultado: any) => ({
    isOnline: () => true,
    enqueue: jest.fn(async () => resultado),
  });
  const agenteOffline = () => ({ isOnline: () => false, enqueue: jest.fn() });

  let request: jest.SpyInstance;
  beforeEach(() => {
    delete process.env.FACIAL_HTTP_DIRETO_REDE_INTERNA;
    request = jest.spyOn(axios, 'request').mockResolvedValue({ status: 200, headers: {}, data: {} } as any);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.FACIAL_HTTP_DIRETO_REDE_INTERNA;
  });

  describe('pelo agente', () => {
    it.each([
      // [resultado do agente, ok, motivo]
      [{ ok: true, statusCode: 200 }, true, null],
      [{ ok: true }, true, null],
      // agente novo: já manda o motivo
      [{ ok: false, motivo: 'credencial' }, false, 'credencial_invalida'],
      [{ ok: false, motivo: 'sem_resposta' }, false, 'sem_resposta'],
      [{ ok: false, motivo: 'recusado' }, false, 'recusado'],
      [{ ok: false, motivo: 'protocolo_inesperado' }, false, 'protocolo_inesperado'],
      // o motivo do agente vale mais que o statusCode
      [{ ok: false, motivo: 'recusado', statusCode: 401 }, false, 'recusado'],
      // motivo que a nuvem não conhece: deriva do statusCode/erro
      [{ ok: false, motivo: 'novidade', statusCode: 404 }, false, 'protocolo_inesperado'],
      // agente antigo: só statusCode/erro
      [{ ok: false, statusCode: 401 }, false, 'credencial_invalida'],
      [{ ok: false, statusCode: 403 }, false, 'credencial_invalida'],
      [{ ok: false, statusCode: 404 }, false, 'protocolo_inesperado'],
      [{ ok: false, statusCode: 400 }, false, 'protocolo_inesperado'],
      [{ ok: false, statusCode: 500 }, false, 'protocolo_inesperado'],
      [{ ok: false, statusCode: 200, error: 'Control iD: login não retornou session' }, false, 'protocolo_inesperado'],
      [{ ok: false, error: 'timeout' }, false, 'sem_resposta'],
      [{ ok: false, error: 'connect ETIMEDOUT 192.168.1.50:80' }, false, 'sem_resposta'],
      [{ ok: false, error: 'connect EHOSTUNREACH 192.168.1.50:80' }, false, 'sem_resposta'],
      [{ ok: false, error: 'connect ECONNREFUSED 192.168.1.50:80' }, false, 'recusado'],
      [{ ok: false, error: 'socket hang up' }, false, 'protocolo_inesperado'],
      [{ ok: false, error: 'Tempo esgotado: o agente local não respondeu.' }, false, 'sem_resposta'],
      [{ ok: false, error: 'Agente local não está conectado para este dispositivo.' }, false, 'agente_offline'],
      [{ ok: false }, false, 'sem_resposta'],
    ])('%j → ok=%s motivo=%s', async (resultado, ok, motivo) => {
      const agente = agenteOnline(resultado);
      const client = new FacialDeviceClientService(agente as any);
      const d = await client.diagnosticar(dev());
      expect(d.ok).toBe(ok);
      expect(d.motivo).toBe(motivo);
      expect(agente.enqueue).toHaveBeenCalledWith(7, { type: 'ping' });
      expect(request).not.toHaveBeenCalled();
    });

    it('marca sem comando HTTP: o erro do agente vira marca_sem_http', async () => {
      const client = new FacialDeviceClientService(
        agenteOnline({ ok: false, error: 'zkteco usa protocolo TCP/UDP na porta 4370 — não aceita comando via HTTP.' }) as any,
      );
      const d = await client.diagnosticar(dev({ fabricante: 'zkteco' }));
      expect(d).toMatchObject({ ok: false, motivo: 'marca_sem_http' });
    });
  });

  describe('sem agente', () => {
    it('simulador responde ok sem rede', async () => {
      const client = new FacialDeviceClientService(agenteOffline() as any);
      await expect(client.diagnosticar(dev({ ip: 'sim' }))).resolves.toEqual({ ok: true, motivo: null });
      expect(request).not.toHaveBeenCalled();
    });

    it.each(['zkteco', 'topdata', 'henry'])('%s → marca_sem_http, sem chamar o aparelho', async (fabricante) => {
      const client = new FacialDeviceClientService(agenteOffline() as any);
      const d = await client.diagnosticar(dev({ fabricante, ip: '8.8.8.8' }));
      expect(d).toMatchObject({ ok: false, motivo: 'marca_sem_http' });
      expect(d.detalhe).toContain(fabricante);
      expect(request).not.toHaveBeenCalled();
    });

    it.each(['10.0.0.5', '172.16.3.4', '192.168.1.10', '127.0.0.1'])(
      'terminal em %s (só o agente alcança) → agente_offline, sem chamar da nuvem',
      async (ip) => {
        const client = new FacialDeviceClientService(agenteOffline() as any);
        const d = await client.diagnosticar(dev({ ip, fabricante: 'hikvision' }));
        expect(d).toMatchObject({ ok: false, motivo: 'agente_offline' });
        expect(request).not.toHaveBeenCalled();
      },
    );

    it('Control iD em rede interna também → agente_offline', async () => {
      const client = new FacialDeviceClientService(agenteOffline() as any);
      const d = await client.diagnosticar(dev({ ip: '10.1.2.3', fabricante: 'control_id' }));
      expect(d).toMatchObject({ ok: false, motivo: 'agente_offline' });
    });

    describe('modo direto (endereço público)', () => {
      it.each([
        [200, true, null],
        [204, true, null],
        [401, false, 'credencial_invalida'],
        [403, false, 'credencial_invalida'],
        [404, false, 'protocolo_inesperado'],
        [405, false, 'protocolo_inesperado'],
        [500, false, 'protocolo_inesperado'],
      ])('HTTP %i → ok=%s motivo=%s', async (status, ok, motivo) => {
        request.mockResolvedValue({ status, headers: {}, data: {} } as any);
        const client = new FacialDeviceClientService(agenteOffline() as any);
        for (const fabricante of ['hikvision', 'intelbras', 'genérico']) {
          const d = await client.diagnosticar(dev({ ip: '8.8.8.8', fabricante }));
          expect(d.ok).toBe(ok);
          expect(d.motivo).toBe(motivo);
          if (!ok) expect(d.detalhe).toBe(`HTTP ${status}`);
        }
      });

      it.each([
        [{ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 8.8.8.8:80' }, 'recusado'],
        [{ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' }, 'sem_resposta'],
        [{ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT 8.8.8.8:80' }, 'sem_resposta'],
        [{ code: 'EHOSTUNREACH', message: 'connect EHOSTUNREACH 8.8.8.8:80' }, 'sem_resposta'],
        [{ code: 'ENETUNREACH', message: 'connect ENETUNREACH 8.8.8.8:80' }, 'sem_resposta'],
        [{ code: 'ECONNRESET', message: 'socket hang up' }, 'protocolo_inesperado'],
      ])('erro de rede %j → %s', async (erro, motivo) => {
        request.mockRejectedValue(Object.assign(new Error(erro.message), { code: erro.code }));
        const client = new FacialDeviceClientService(agenteOffline() as any);
        const d = await client.diagnosticar(dev({ ip: '8.8.8.8', fabricante: 'hikvision' }));
        expect(d).toMatchObject({ ok: false, motivo });
      });

      const controlId = (post: jest.Mock) =>
        jest.spyOn(axios, 'create').mockReturnValue({ interceptors: { request: { use: jest.fn() } }, post } as any);

      it('Control iD: login recusado (401) → credencial_invalida', async () => {
        controlId(
          jest.fn().mockRejectedValue(
            Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } }),
          ),
        );
        const client = new FacialDeviceClientService(agenteOffline() as any);
        const d = await client.diagnosticar(dev({ ip: '8.8.8.8', fabricante: 'control_id' }));
        expect(d).toMatchObject({ ok: false, motivo: 'credencial_invalida', detalhe: 'HTTP 401' });
      });

      it('Control iD: respondeu 200 sem session (não é Control iD) → protocolo_inesperado', async () => {
        controlId(jest.fn().mockResolvedValue({ status: 200, data: {} }));
        const client = new FacialDeviceClientService(agenteOffline() as any);
        const d = await client.diagnosticar(dev({ ip: '8.8.8.8', fabricante: 'control_id' }));
        expect(d).toMatchObject({ ok: false, motivo: 'protocolo_inesperado' });
      });

      it('Control iD: login com session → ok', async () => {
        controlId(jest.fn().mockResolvedValue({ status: 200, data: { session: 'abc' } }));
        const client = new FacialDeviceClientService(agenteOffline() as any);
        await expect(client.diagnosticar(dev({ ip: '8.8.8.8', fabricante: 'control_id' }))).resolves.toEqual({
          ok: true,
          motivo: null,
        });
      });
    });
  });

  describe('o detalhe nunca leva a senha', () => {
    const basic = Buffer.from(`admin:${SENHA}`).toString('base64');

    it('erro vindo do agente com a senha e o Basic no texto', async () => {
      const client = new FacialDeviceClientService(
        agenteOnline({
          ok: false,
          statusCode: 401,
          error: `falha em http://admin:${SENHA}@192.168.1.50/ (Authorization: Basic ${basic}) password=${encodeURIComponent(SENHA)}`,
        }) as any,
      );
      const d = await client.diagnosticar(dev());
      expect(d.motivo).toBe('credencial_invalida');
      expect(d.detalhe).toBeDefined();
      expect(d.detalhe).not.toContain(SENHA);
      expect(d.detalhe).not.toContain(basic);
      expect(d.detalhe).not.toContain(encodeURIComponent(SENHA));
    });

    it('erro de rede do modo direto com a senha na mensagem', async () => {
      request.mockRejectedValue(
        Object.assign(new Error(`connect ECONNREFUSED http://admin:${SENHA}@8.8.8.8:80`), { code: 'ECONNREFUSED' }),
      );
      const client = new FacialDeviceClientService(agenteOffline() as any);
      const d = await client.diagnosticar(dev({ ip: '8.8.8.8', fabricante: 'hikvision' }));
      expect(d.motivo).toBe('recusado');
      expect(d.detalhe).not.toContain(SENHA);
    });

    it('detalhe é curto mesmo com erro gigante', async () => {
      const client = new FacialDeviceClientService(agenteOnline({ ok: false, error: 'x'.repeat(5000) }) as any);
      const d = await client.diagnosticar(dev());
      expect((d.detalhe ?? '').length).toBeLessThanOrEqual(200);
    });
  });

  describe('ping continua boolean e delega', () => {
    it.each([
      [{ ok: true, statusCode: 200 }, true],
      [{ ok: false, statusCode: 401 }, false],
      [{ ok: false, error: 'timeout' }, false],
    ])('agente %j → %s', async (resultado, esperado) => {
      const client = new FacialDeviceClientService(agenteOnline(resultado) as any);
      const diag = jest.spyOn(client, 'diagnosticar');
      await expect(client.ping(dev())).resolves.toBe(esperado);
      expect(diag).toHaveBeenCalledTimes(1);
    });

    it('sem agente e rede interna → false', async () => {
      const client = new FacialDeviceClientService(agenteOffline() as any);
      await expect(client.ping(dev({ fabricante: 'hikvision' }))).resolves.toBe(false);
    });
  });
});
