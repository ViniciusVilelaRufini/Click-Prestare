import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface FacialDeviceConfig {
  id: number;
  ip: string;
  porta: number;
  api_user: string | null;
  api_password: string | null;
  fabricante: string;
}

export interface EnrollPayload {
  externalId: string;
  nome: string;
  fotoBase64: string;
}

export interface EnrollResult {
  faceId: string;
}

@Injectable()
export class FacialDeviceClientService {
  private readonly logger = new Logger(FacialDeviceClientService.name);
  private readonly timeoutMs = Number(process.env.FACIAL_HTTP_TIMEOUT_MS ?? 10000);

  private http(device: FacialDeviceConfig): AxiosInstance {
    const baseURL = `http://${device.ip}:${device.porta}`;
    const auth =
      device.api_user && device.api_password
        ? { username: device.api_user, password: device.api_password }
        : undefined;
    return axios.create({ baseURL, auth, timeout: this.timeoutMs });
  }

  async ping(device: FacialDeviceConfig): Promise<boolean> {
    try {
      const res = await this.http(device).get('/status');
      return res.status >= 200 && res.status < 300;
    } catch (err: any) {
      this.logger.warn(`Ping falhou no device ${device.id} (${device.ip}): ${err?.message ?? err}`);
      return false;
    }
  }

  /**
   * Mapa de endpoints de "abrir porta/catraca" por fabricante.
   *
   * NOTA: esses paths são baseados em documentação pública conhecida.
   * Antes de colocar em produção, valide com o manual do dispositivo
   * específico — alguns fabricantes mudam o path entre firmwares.
   * Quando o fabricante não está mapeado, usa o fallback POST /open_door
   * (padrão comum de botoeiras genéricas HTTP).
   */
  private readonly relayEndpoints: Record<
    string,
    { method: 'POST' | 'PUT'; path: string; body?: any; contentType?: string }
  > = {
    control_id: { method: 'POST', path: '/actions/open_door', body: { door_id: 1 } },
    intelbras: { method: 'POST', path: '/api/v1/door/open' },
    hikvision: {
      method: 'PUT',
      path: '/ISAPI/AccessControl/RemoteControl/door/1',
      body: '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>',
      contentType: 'application/xml',
    },
    henry: { method: 'POST', path: '/api/door/open' },
    topdata: { method: 'POST', path: '/Rep/Bio.svc/AbrirPorta' },
    zkteco: { method: 'POST', path: '/api/door/open' },
    genérico: { method: 'POST', path: '/open_door' },
  };

  /**
   * Aciona o relé de abertura do dispositivo (botoeira ou catraca).
   *
   * Retorna { ok, statusCode, error }:
   *   - ok=true só quando o hardware retornou HTTP 2xx
   *   - ok=false quando o hardware respondeu erro, está offline ou deu timeout
   *
   * IMPORTANTE: nunca retorne ok=true em caso de falha. O operador precisa
   * saber se a porta abriu ou não — visitante esperando do outro lado.
   */
  async triggerRelay(device: FacialDeviceConfig): Promise<{
    ok: boolean;
    statusCode?: number;
    error?: string;
  }> {
    try {
      const endpoint =
        this.relayEndpoints[device.fabricante] ?? this.relayEndpoints['genérico'];
      const config: any = {};
      if (endpoint.contentType) {
        config.headers = { 'Content-Type': endpoint.contentType };
      }
      const res = endpoint.method === 'PUT'
        ? await this.http(device).put(endpoint.path, endpoint.body ?? {}, config)
        : await this.http(device).post(endpoint.path, endpoint.body ?? {}, config);
      const ok = res.status >= 200 && res.status < 300;
      return { ok, statusCode: res.status };
    } catch (err: any) {
      const statusCode = err?.response?.status;
      const msg = err?.message ?? String(err);
      this.logger.warn(`Trigger relay falhou no device ${device.id} (${device.ip}): ${msg}`);
      return { ok: false, statusCode, error: msg };
    }
  }

  async enrollPerson(device: FacialDeviceConfig, payload: EnrollPayload): Promise<EnrollResult> {
    const body = {
      external_id: payload.externalId,
      name: payload.nome,
      image_base64: payload.fotoBase64,
    };
    const res = await this.http(device).post('/persons', body);
    const faceId = res.data?.id ?? res.data?.face_id ?? payload.externalId;
    return { faceId: String(faceId) };
  }

  async updatePerson(
    device: FacialDeviceConfig,
    faceId: string,
    payload: Partial<EnrollPayload>,
  ): Promise<void> {
    const body: any = {};
    if (payload.nome !== undefined) body.name = payload.nome;
    if (payload.fotoBase64 !== undefined) body.image_base64 = payload.fotoBase64;
    await this.http(device).put(`/persons/${faceId}`, body);
  }

  async removePerson(device: FacialDeviceConfig, faceId: string): Promise<void> {
    try {
      await this.http(device).delete(`/persons/${faceId}`);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        this.logger.warn(`Pessoa ${faceId} já não existia no device ${device.id}`);
        return;
      }
      throw err;
    }
  }
}
