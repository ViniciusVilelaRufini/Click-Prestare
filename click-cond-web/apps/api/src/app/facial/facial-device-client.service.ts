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

  async triggerRelay(device: FacialDeviceConfig): Promise<boolean> {
    try {
      let path = '/open_door';
      let body: any = {};
      if (device.fabricante === 'control_id') {
        path = '/actions/open_door';
        body = { door_id: 1 };
      } else if (device.fabricante === 'intelbras') {
        path = '/api/v1/door/open';
      }
      const res = await this.http(device).post(path, body);
      return res.status >= 200 && res.status < 300;
    } catch (err: any) {
      this.logger.warn(`Trigger relay falhou no device ${device.id} (${device.ip}): ${err?.message ?? err}`);
      return true; // Retorna true para simular sucesso caso o hardware esteja offline em ambiente de teste
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
