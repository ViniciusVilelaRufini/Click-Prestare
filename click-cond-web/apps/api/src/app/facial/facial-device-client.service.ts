import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, Method } from 'axios';
import * as https from 'https';
import * as crypto from 'crypto';
import { AgentBridgeService } from './agent-bridge.service';

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
  /** Validade no aparelho (Dahua "YYYY-MM-DD HH:MM:SS"). Default = permanente. */
  validFrom?: string;
  validTo?: string;
  userTimes?: number;
}

export interface EnrollResult {
  faceId: string;
}

/**
 * Fabricantes que NÃO falam HTTP para comandos (abrir porta / cadastrar rosto).
 * Usam protocolo binário em porta própria ou SDK — não dá para acionar via
 * requisição HTTP. Validado contra documentação pública (jun/2026). Para esses
 * casos, use uma botoeira/relé HTTP genérico no acionamento ou um bridge SDK.
 */
const SEM_COMANDO_HTTP: Record<string, string> = {
  zkteco: 'protocolo TCP/UDP na porta 4370 (PULL/PUSH SDK)',
  topdata: 'protocolo TCP na porta 3570 (SDK Inner)',
  henry: 'protocolo proprietário (SDK Henry)',
};

/**
 * Cliente que conversa com o hardware de controle de acesso.
 *
 * Três transportes, escolhidos automaticamente:
 *   1. ip === "sim"            → simulador interno (HTML), sem hardware
 *   2. agente online no device → enfileira comando lógico p/ o Agente Local
 *      executar na LAN (caminho padrão em produção SaaS, ver AgentBridgeService)
 *   3. fallback                → HTTP direto no IP (on-premise / mesma LAN)
 *
 * Protocolos por fabricante validados contra documentação pública (jun/2026):
 *   - control_id: REST com sessão (.fcgi) — VALIDADO
 *   - hikvision:  ISAPI + Digest auth — VALIDADO
 *   - intelbras:  comando via CGI fica atrás do suporte — NÃO VALIDADO
 *   - genérico:   HTTP simples (botoeira/relé)
 *   - zkteco/topdata/henry: não usam HTTP (ver SEM_COMANDO_HTTP)
 *
 * O Agente Local tem cópia equivalente (deploy independente, ver agent/).
 * Mantenha os dois em sincronia ao ajustar um fabricante.
 */
@Injectable()
export class FacialDeviceClientService {
  private readonly logger = new Logger(FacialDeviceClientService.name);
  private readonly timeoutMs = Number(
    process.env.FACIAL_HTTP_TIMEOUT_MS ?? 10000,
  );

  constructor(private readonly agent: AgentBridgeService) {}

  private isSim(device: FacialDeviceConfig): boolean {
    return device.ip === 'sim' || device.ip === 'simulador';
  }

  private baseUrl(device: FacialDeviceConfig): string {
    const isHttps =
      device.porta === 443 || process.env.FACIAL_FORCE_HTTPS === 'true';
    return `${isHttps ? 'https' : 'http'}://${device.ip}:${device.porta}`;
  }

  /** Axios para Control iD: sem Basic auth (usa sessão na query). */
  private http(device: FacialDeviceConfig): AxiosInstance {
    const isHttps =
      device.porta === 443 || process.env.FACIAL_FORCE_HTTPS === 'true';
    return axios.create({
      baseURL: this.baseUrl(device),
      timeout: this.timeoutMs,
      // Aparelhos de LAN usam certificado self-signed; a rede local é confiável.
      httpsAgent: isHttps
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined,
    });
  }

  /**
   * Requisição HTTP a um device que usa autenticação por header (Basic ou
   * Digest). Tenta Basic; se levar 401 com desafio Digest (caso da Hikvision),
   * recalcula e repete. Cobre os dois esquemas sem config por fabricante.
   */
  private async send(
    device: FacialDeviceConfig,
    method: Method,
    path: string,
    data?: unknown,
    contentType?: string,
  ) {
    const url = this.baseUrl(device) + path;
    const isHttps = url.startsWith('https');
    const httpsAgent = isHttps
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;
    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;

    const hasAuth = !!(device.api_user && device.api_password);
    if (hasAuth) {
      headers['Authorization'] =
        'Basic ' +
        Buffer.from(`${device.api_user}:${device.api_password}`).toString(
          'base64',
        );
    }

    let res = await axios.request({
      url,
      method,
      data,
      headers,
      timeout: this.timeoutMs,
      httpsAgent,
      validateStatus: () => true,
    });

    const wwwAuth = res.headers?.['www-authenticate'];
    if (res.status === 401 && hasAuth && wwwAuth && /digest/i.test(wwwAuth)) {
      const uri = path;
      headers['Authorization'] = this.buildDigest(
        device.api_user!,
        device.api_password!,
        String(method).toUpperCase(),
        uri,
        wwwAuth,
      );
      res = await axios.request({
        url,
        method,
        data,
        headers,
        timeout: this.timeoutMs,
        httpsAgent,
        validateStatus: () => true,
      });
    }
    return res;
  }

  private md5(s: string): string {
    return crypto.createHash('md5').update(s).digest('hex');
  }

  /** Monta o header Authorization: Digest a partir do desafio WWW-Authenticate. */
  private buildDigest(
    user: string,
    pass: string,
    method: string,
    uri: string,
    challenge: string,
  ): string {
    const get = (k: string) => {
      const m = challenge.match(new RegExp(`${k}="?([^",]+)"?`, 'i'));
      return m ? m[1] : '';
    };
    const realm = get('realm');
    const nonce = get('nonce');
    const opaque = get('opaque');
    const algorithm = get('algorithm') || 'MD5';
    const qop = get('qop') ? get('qop').split(',')[0].trim() : '';
    const ha1 = this.md5(`${user}:${realm}:${pass}`);
    const ha2 = this.md5(`${method}:${uri}`);
    const nc = '00000001';
    const cnonce = crypto.randomBytes(8).toString('hex');
    const response = qop
      ? this.md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : this.md5(`${ha1}:${nonce}:${ha2}`);
    let h = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}", algorithm=${algorithm}`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    if (opaque) h += `, opaque="${opaque}"`;
    return h;
  }

  async ping(device: FacialDeviceConfig): Promise<boolean> {
    if (this.isSim(device)) return true;
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, { type: 'ping' });
      return r.ok;
    }
    if (SEM_COMANDO_HTTP[device.fabricante]) return false;
    try {
      // Control iD não tem /status: um login bem-sucedido prova conectividade.
      if (device.fabricante === 'control_id') {
        await this.controlIdLogin(device);
        return true;
      }
      // Intelbras SS (Dahua): cgi com Digest prova conectividade SEM criar uma
      // sessão RPC2 (que vazaria e estouraria "too many connections" no aparelho).
      if (device.fabricante === 'intelbras') {
        const r = await this.send(
          device,
          'GET',
          '/cgi-bin/magicBox.cgi?action=getDeviceType',
        );
        return r.status >= 200 && r.status < 300;
      }
      if (device.fabricante === 'hikvision') {
        const r = await this.send(device, 'GET', '/ISAPI/System/deviceInfo');
        return r.status >= 200 && r.status < 300;
      }
      const res = await this.send(device, 'GET', '/status');
      return res.status >= 200 && res.status < 300;
    } catch (err: any) {
      this.logger.warn(
        `Ping falhou no device ${device.id} (${device.ip}): ${err?.message ?? err}`,
      );
      return false;
    }
  }

  /**
   * Endpoints de "abrir porta/catraca" por fabricante que falam HTTP (modo
   * DIRETO). control_id é tratado à parte (sessão). zkteco/topdata/henry não
   * entram aqui — não usam HTTP (ver SEM_COMANDO_HTTP).
   */
  private readonly relayEndpoints: Record<
    string,
    { method: 'POST' | 'PUT'; path: string; body?: any; contentType?: string }
  > = {
    // NÃO VALIDADO: CGI de comando da Intelbras fica atrás do suporte técnico.
    intelbras: { method: 'POST', path: '/api/v1/door/open' },
    // VALIDADO (ISAPI). Requer Digest auth — tratado em send().
    hikvision: {
      method: 'PUT',
      path: '/ISAPI/AccessControl/RemoteControl/door/1',
      body: '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>',
      contentType: 'application/xml',
    },
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
    // Modo simulador: ip "sim" indica botoeira virtual (HTML).
    if (this.isSim(device)) {
      try {
        const baseUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';
        const res = await axios.post(
          `${baseUrl}/api/facial/sim/relay/${device.id}/trigger`,
          { deviceId: device.id, at: new Date().toISOString() },
          { timeout: 3000 },
        );
        const ok = res.status >= 200 && res.status < 300;
        return { ok, statusCode: res.status };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    }

    // Caminho padrão em produção: delega ao Agente Local da LAN.
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, { type: 'open_door' });
      return { ok: r.ok, statusCode: r.statusCode, error: r.error };
    }

    // Fabricante que não fala HTTP — não há como acionar por requisição.
    if (SEM_COMANDO_HTTP[device.fabricante]) {
      return {
        ok: false,
        error: `${device.fabricante} usa ${SEM_COMANDO_HTTP[device.fabricante]} — não aceita acionamento via HTTP. Use uma botoeira/relé HTTP genérico ou um bridge SDK.`,
      };
    }

    // Fallback: HTTP direto (backend on-premise / mesma LAN do aparelho).
    try {
      if (device.fabricante === 'control_id') {
        const session = await this.controlIdLogin(device);
        const res = await this.http(device).post(
          `/execute_actions.fcgi?session=${session}`,
          { actions: [{ action: 'door', parameters: 'door=1' }] },
        );
        const ok = res.status >= 200 && res.status < 300;
        return { ok, statusCode: res.status };
      }
      // Intelbras SS (Dahua): abre o relé via cgi com Digest.
      if (device.fabricante === 'intelbras') {
        const res = await this.send(
          device,
          'GET',
          '/cgi-bin/accessControl.cgi?action=openDoor&channel=1',
        );
        return {
          ok: res.status >= 200 && res.status < 300,
          statusCode: res.status,
        };
      }
      const endpoint =
        this.relayEndpoints[device.fabricante] ??
        this.relayEndpoints['genérico'];
      const res = await this.send(
        device,
        endpoint.method,
        endpoint.path,
        endpoint.body ?? {},
        endpoint.contentType,
      );
      const ok = res.status >= 200 && res.status < 300;
      return { ok, statusCode: res.status };
    } catch (err: any) {
      const statusCode = err?.response?.status;
      const msg = err?.message ?? String(err);
      this.logger.warn(
        `Trigger relay falhou no device ${device.id} (${device.ip}): ${msg}`,
      );
      return { ok: false, statusCode, error: msg };
    }
  }

  /**
   * Captura um quadro (JPEG base64) da câmera do facial — para usar como foto de
   * cadastro. Usa o Agente Local (a câmera está na LAN). Só Intelbras/Dahua.
   */
  async captureSnapshot(device: FacialDeviceConfig): Promise<string> {
    if (!this.agent.isOnline(device.id)) {
      throw new Error(
        'Agente Local não está conectado — a captura usa a câmera do aparelho pela rede.',
      );
    }
    const r = await this.agent.enqueue(device.id, { type: 'snapshot' });
    if (!r.ok || !r.imageBase64) {
      throw new Error(r.error ?? 'Falha ao capturar foto no aparelho.');
    }
    return r.imageBase64;
  }

  async enrollPerson(
    device: FacialDeviceConfig,
    payload: EnrollPayload,
  ): Promise<EnrollResult> {
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, {
        type: 'enroll',
        externalId: payload.externalId,
        nome: payload.nome,
        fotoBase64: payload.fotoBase64,
        validFrom: payload.validFrom,
        validTo: payload.validTo,
        userTimes: payload.userTimes,
      });
      if (!r.ok)
        throw new Error(r.error ?? 'Falha ao cadastrar pessoa via agente');
      return { faceId: r.faceId ?? payload.externalId };
    }

    if (SEM_COMANDO_HTTP[device.fabricante]) {
      throw new Error(
        `${device.fabricante} usa ${SEM_COMANDO_HTTP[device.fabricante]} — cadastro de rosto não é possível via HTTP direto. Use o Agente Local com bridge SDK.`,
      );
    }
    if (device.fabricante === 'control_id') {
      return this.controlIdEnroll(device, payload);
    }
    if (device.fabricante === 'intelbras') {
      const userId = String(payload.externalId);
      await this.dahuaUpsertUser(
        device,
        userId,
        payload.nome,
        payload.validFrom,
        payload.validTo,
        payload.userTimes,
      );
      if (payload.fotoBase64) await this.dahuaSetFace(device, userId, payload.fotoBase64);
      return { faceId: userId };
    }
    if (device.fabricante === 'hikvision') {
      const employeeNo = String(payload.externalId);
      await this.hikvisionUpsertUser(device, employeeNo, payload.nome, payload.validFrom, payload.validTo);
      if (payload.fotoBase64) await this.hikvisionSetFace(device, employeeNo, payload.fotoBase64);
      return { faceId: employeeNo };
    }
    const res = await this.send(device, 'POST', '/persons', {
      external_id: payload.externalId,
      name: payload.nome,
      image_base64: payload.fotoBase64,
    });
    const faceId = res.data?.id ?? res.data?.face_id ?? payload.externalId;
    return { faceId: String(faceId) };
  }

  async updatePerson(
    device: FacialDeviceConfig,
    faceId: string,
    payload: Partial<EnrollPayload>,
  ): Promise<void> {
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, {
        type: 'update',
        faceId,
        nome: payload.nome,
        fotoBase64: payload.fotoBase64,
        validFrom: payload.validFrom,
        validTo: payload.validTo,
        userTimes: payload.userTimes,
      });
      if (!r.ok)
        throw new Error(r.error ?? 'Falha ao atualizar pessoa via agente');
      return;
    }

    if (SEM_COMANDO_HTTP[device.fabricante]) {
      throw new Error(
        `${device.fabricante} usa ${SEM_COMANDO_HTTP[device.fabricante]} — atualização de rosto não é possível via HTTP direto.`,
      );
    }
    if (device.fabricante === 'control_id') {
      await this.controlIdUpdate(device, faceId, payload);
      return;
    }
    if (device.fabricante === 'intelbras') {
      const userId = String(faceId);
      await this.dahuaUpsertUser(
        device,
        userId,
        payload.nome ?? userId,
        payload.validFrom,
        payload.validTo,
        payload.userTimes,
      );
      if (payload.fotoBase64 !== undefined)
        await this.dahuaSetFace(device, userId, payload.fotoBase64);
      return;
    }
    if (device.fabricante === 'hikvision') {
      const employeeNo = String(faceId);
      await this.hikvisionUpsertUser(device, employeeNo, payload.nome ?? employeeNo, payload.validFrom, payload.validTo);
      if (payload.fotoBase64 !== undefined) await this.hikvisionSetFace(device, employeeNo, payload.fotoBase64);
      return;
    }
    const body: any = {};
    if (payload.nome !== undefined) body.name = payload.nome;
    if (payload.fotoBase64 !== undefined)
      body.image_base64 = payload.fotoBase64;
    await this.send(device, 'PUT', `/persons/${faceId}`, body);
  }

  async removePerson(
    device: FacialDeviceConfig,
    faceId: string,
  ): Promise<void> {
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, { type: 'remove', faceId });
      if (!r.ok && r.statusCode !== 404) {
        throw new Error(r.error ?? 'Falha ao remover pessoa via agente');
      }
      return;
    }

    if (SEM_COMANDO_HTTP[device.fabricante]) return; // nada a fazer via HTTP
    try {
      if (device.fabricante === 'control_id') {
        const session = await this.controlIdLogin(device);
        await this.http(device).post(
          `/destroy_objects.fcgi?session=${session}`,
          {
            object: 'users',
            where: { users: { id: Number(faceId) } },
          },
        );
        return;
      }
      if (device.fabricante === 'intelbras') {
        // Array vai como query-param (?UserIDList[0]=id), não JSON.
        await this.send(
          device,
          'GET',
          `/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${encodeURIComponent(faceId)}`,
        );
        return;
      }
      if (device.fabricante === 'hikvision') {
        const employeeNo = String(faceId);
        await this.send(device, 'PUT', '/ISAPI/Intelligent/FDLib/FDSetUp?format=json&FDID=1&faceLibType=blackFD', { FPID: [{ value: employeeNo }] }, 'application/json').catch(() => undefined);
        await this.send(device, 'PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', { UserInfoDelCond: { EmployeeNoList: [{ employeeNo }] } }, 'application/json');
        return;
      }
      const res = await this.send(device, 'DELETE', `/persons/${faceId}`);
      if (res.status === 404) {
        this.logger.warn(
          `Pessoa ${faceId} já não existia no device ${device.id}`,
        );
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        this.logger.warn(
          `Pessoa ${faceId} já não existia no device ${device.id}`,
        );
        return;
      }
      throw err;
    }
  }

  // ---------- Control iD (modo direto) ----------
  //
  // VALIDADO contra a doc oficial da API Linha de Acesso (controlid.com.br,
  // jun/2026). Control iD usa sessão, não HTTP Basic: POST /login.fcgi
  // {login, password} devolve { session }, que vai como ?session= nas demais
  // chamadas. Endpoints terminam em .fcgi.
  //   - abrir porta:    POST /execute_actions.fcgi  {actions:[{action:"door",parameters:"door=1"}]}
  //   - criar usuário:  POST /create_objects.fcgi   {object:"users",values:[{name,registration}]} → {ids:[id]}
  //   - foto do rosto:  POST /user_set_image.fcgi?user_id=&match=1  (octet-stream, < 2MB)
  //   - editar:         POST /modify_objects.fcgi   {object:"users",values:{name},where:{users:{id}}}
  //   - remover:        POST /destroy_objects.fcgi  {object:"users",where:{users:{id}}}
  //
  // Guardamos o id interno (ids[0]) como face_id — é por ele que o webhook
  // resolve a pessoa (o push do aparelho só manda user_id, não registration).

  private async controlIdLogin(device: FacialDeviceConfig): Promise<string> {
    const res = await this.http(device).post('/login.fcgi', {
      login: device.api_user ?? 'admin',
      password: device.api_password ?? 'admin',
    });
    const session = res.data?.session;
    if (!session) throw new Error('Control iD: login não retornou session');
    return String(session);
  }

  /**
   * Cria a pessoa no Control iD e devolve o user_id INTERNO do aparelho como
   * face_id. Guardar o user_id (não o registration) é o que permite o webhook
   * resolver a pessoa quando o aparelho dispara o evento (o push só manda
   * user_id). O registration ("morador_42") fica como rótulo legível no device.
   */
  private async controlIdEnroll(
    device: FacialDeviceConfig,
    payload: EnrollPayload,
  ): Promise<EnrollResult> {
    const session = await this.controlIdLogin(device);
    const http = this.http(device);
    const registration = String(payload.externalId);

    const created = await http.post(`/create_objects.fcgi?session=${session}`, {
      object: 'users',
      values: [{ name: payload.nome || registration, registration }],
    });
    const userId = created.data?.ids?.[0];
    if (userId == null)
      throw new Error('Control iD: create_objects não retornou id');

    if (payload.fotoBase64) {
      await http.post(
        `/user_set_image.fcgi?session=${session}&user_id=${userId}&match=1&timestamp=${Math.floor(Date.now() / 1000)}`,
        Buffer.from(payload.fotoBase64, 'base64'),
        { headers: { 'Content-Type': 'application/octet-stream' } },
      );
    }

    return { faceId: String(userId) };
  }

  /** Atualiza nome/foto no Control iD pelo user_id interno (= face_id salvo). */
  private async controlIdUpdate(
    device: FacialDeviceConfig,
    faceId: string,
    payload: Partial<EnrollPayload>,
  ): Promise<void> {
    const session = await this.controlIdLogin(device);
    const http = this.http(device);
    const userId = Number(faceId);
    if (payload.nome !== undefined) {
      await http.post(`/modify_objects.fcgi?session=${session}`, {
        object: 'users',
        values: { name: payload.nome },
        where: { users: { id: userId } },
      });
    }
    if (payload.fotoBase64 !== undefined) {
      await http.post(
        `/user_set_image.fcgi?session=${session}&user_id=${userId}&match=1&timestamp=${Math.floor(Date.now() / 1000)}`,
        Buffer.from(payload.fotoBase64, 'base64'),
        { headers: { 'Content-Type': 'application/octet-stream' } },
      );
    }
  }

  // ---------- Dahua / Intelbras (linha SS facial: SS 3530 MF FACE etc.) ----------
  //
  // VALIDADO ao vivo num SS 3530 MF FACE W (firmware 2.000.00IB004, 2021). A
  // Intelbras é OEM da Dahua. Mantém em sincronia com o Agente Local (agent/),
  // que é o caminho padrão em produção; este é o modo direto (on-premise).
  //   - login:    RPC2 global.login em 2 etapas (challenge → hash MD5 maiúsculo)
  //   - usuário:  cgi AccessUser.cgi insertMulti/updateMulti (Digest)
  //   - rosto:    cgi AccessFace.cgi insertMulti (foto base64, Digest)
  // O faceId guardado é o próprio UserID (nosso external_id, ex.: "morador_42").

  /** Desserializa a resposta do RPC2 (que vem sem Content-Type). */
  private rpcData(res: { data: unknown }): any {
    if (typeof res.data === 'string') {
      try {
        return JSON.parse(res.data);
      } catch {
        return {};
      }
    }
    return res.data ?? {};
  }

  private async dahuaLogin(device: FacialDeviceConfig): Promise<string> {
    const base = this.baseUrl(device);
    const user = device.api_user ?? 'admin';
    const pass = device.api_password ?? 'admin';
    const httpsAgent = base.startsWith('https')
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;
    const post = (data: unknown, cookie?: string) =>
      axios.request({
        url: base + '/RPC2_Login',
        method: 'POST',
        data,
        headers: cookie ? { Cookie: cookie } : {},
        timeout: this.timeoutMs,
        httpsAgent,
        validateStatus: () => true,
      });

    const s1 = await post({
      method: 'global.login',
      params: {
        userName: user,
        password: '',
        clientType: 'Web3.0',
        loginType: 'Direct',
      },
      id: 1,
    });
    const d1 = this.rpcData(s1);
    const p = d1.params ?? {};
    const session = d1.session;
    if (!p.realm || !p.random || !session) {
      throw new Error('Intelbras/Dahua: aparelho não respondeu o desafio (RPC2)');
    }
    const ha = this.md5(`${user}:${p.realm}:${pass}`).toUpperCase();
    const loginHash = this.md5(`${user}:${p.random}:${ha}`).toUpperCase();
    const s2 = await post(
      {
        method: 'global.login',
        params: {
          userName: user,
          password: loginHash,
          clientType: 'Web3.0',
          loginType: 'Direct',
          authorityType: 'Default',
          passwordType: 'Default',
        },
        id: 2,
        session,
      },
      `DWebClientSessionID=${session}`,
    );
    const d2 = this.rpcData(s2);
    if (!d2.result) {
      const msg = d2.error?.message ?? 'login negado';
      throw new Error(`Intelbras/Dahua: ${msg} (confira usuário/senha)`);
    }
    return String(session);
  }

  /** Cria (ou atualiza) o usuário de acesso. ValidFrom em 2000 — ver agent/. */
  private async dahuaUpsertUser(
    device: FacialDeviceConfig,
    userId: string,
    nome?: string,
    validFrom?: string,
    validTo?: string,
    userTimes?: number,
  ): Promise<void> {
    const body = {
      UserList: [
        {
          UserID: userId,
          UserName: nome || userId,
          UserType: typeof userTimes === 'number' && userTimes > 0 ? 1 : 0,
          Authority: 2,
          Doors: [0],
          TimeSections: [255],
          // Visitante: janela da visita (aparelho nega após o término). Morador
          // ou ausente: permanente. Ver agent/ (mesma lógica).
          ValidFrom: validFrom || '2000-01-01 00:00:00',
          ValidTo: validTo || '2037-12-31 23:59:59',
          UseTime: typeof userTimes === 'number' ? userTimes : -1,
        },
      ],
    };
    // Replace limpo: remove antes (idempotente) p/ evitar "Bad Request" de
    // duplicado ao re-sincronizar (trava o cadastro em "pendente"). Ver agent/.
    await this.send(
      device,
      'GET',
      `/cgi-bin/AccessUser.cgi?action=removeMulti&UserIDList[0]=${encodeURIComponent(userId)}`,
    ).catch(() => undefined);
    const r = await this.send(
      device,
      'POST',
      '/cgi-bin/AccessUser.cgi?action=insertMulti',
      body,
      'application/json',
    );
    if (
      !(r.status >= 200 && r.status < 300) ||
      /error/i.test(String(r.data ?? ''))
    ) {
      throw new Error(`Intelbras: falha ao gravar usuário (HTTP ${r.status})`);
    }
  }

  /** Sobe o rosto. O aparelho extrai a biometria e recusa imagem sem rosto. */
  private async dahuaSetFace(
    device: FacialDeviceConfig,
    userId: string,
    fotoBase64: string,
  ): Promise<void> {
    const body = { FaceList: [{ UserID: userId, PhotoData: [fotoBase64] }] };
    let r = await this.send(
      device,
      'POST',
      '/cgi-bin/AccessFace.cgi?action=insertMulti',
      body,
      'application/json',
    );
    if (
      !(r.status >= 200 && r.status < 300) ||
      /error/i.test(String(r.data ?? ''))
    ) {
      r = await this.send(
        device,
        'POST',
        '/cgi-bin/AccessFace.cgi?action=updateMulti',
        body,
        'application/json',
      );
    }
    if (
      !(r.status >= 200 && r.status < 300) ||
      /error/i.test(String(r.data ?? ''))
    ) {
      throw new Error(`Intelbras: rosto recusado (HTTP ${r.status})`);
    }
  }

  // ---------- Hikvision ISAPI (modo direto) ----------

  private async hikvisionUpsertUser(
    device: FacialDeviceConfig,
    employeeNo: string,
    nome?: string,
    validFrom?: string,
    validTo?: string,
  ): Promise<void> {
    const toIso = (s?: string, fb?: string) => (s ? s.replace(' ', 'T') : fb);
    const body = {
      UserInfo: [
        {
          employeeNo,
          name: nome || employeeNo,
          userType: 'normal',
          Valid: {
            enable: true,
            beginTime: toIso(validFrom, '2000-01-01T00:00:00'),
            endTime: toIso(validTo, '2037-12-31T23:59:59'),
            timeType: 'local',
          },
          doorRight: '1',
          RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
        },
      ],
    };
    let r = await this.send(device, 'POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', body, 'application/json');
    if (!(r.status >= 200 && r.status < 300) || /error|fail/i.test(String(r.data ?? ''))) {
      r = await this.send(device, 'PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', body, 'application/json');
    }
    if (!(r.status >= 200 && r.status < 300)) {
      throw new Error(`Hikvision: falha ao gravar usuário (HTTP ${r.status})`);
    }
  }

  private async hikvisionSetFace(device: FacialDeviceConfig, employeeNo: string, fotoBase64: string): Promise<void> {
    const mp = this.buildMultipart([
      { name: 'FaceDataRecord', json: { faceLibType: 'blackFD', FDID: '1', FPID: employeeNo } },
      { name: 'img', jpeg: Buffer.from(fotoBase64, 'base64'), filename: 'face.jpg' },
    ]);
    const r = await this.send(device, 'POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json', mp.body, mp.contentType);
    if (!(r.status >= 200 && r.status < 300) || /error|fail/i.test(String(r.data ?? ''))) {
      throw new Error(`Hikvision: rosto recusado (HTTP ${r.status})`);
    }
  }

  async listDahuaUserIds(device: FacialDeviceConfig): Promise<string[]> {
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, { type: 'list_users' });
      if (!r.ok) {
        throw new Error(r.error ?? 'Falha ao listar pessoas via agente');
      }
      return (r as any).userIds || [];
    }

    const countResp = await this.send(
      device,
      'POST',
      '/RPC2',
      { method: 'UserInfo.getCount', params: { Conditions: {} } },
      'application/json',
    );
    const countData = this.rpcData(countResp);
    const total = countData?.params?.Count ?? 0;
    if (total === 0) return [];

    const ids: string[] = [];
    const PAGE = 100;
    let startNo = 0;

    while (startNo < total) {
      const resp = await this.send(
        device,
        'POST',
        '/RPC2',
        {
          method: 'UserInfo.getMulti',
          params: { Conditions: {}, StartNo: startNo, Count: PAGE },
        },
        'application/json',
      );
      const data = this.rpcData(resp);
      const list = data?.params?.UserList ?? [];
      for (const u of list) {
        if (u.UserID && u.UserID !== 'FFFFFF') {
          ids.push(u.UserID);
        }
      }
      startNo += PAGE;
      if (list.length < PAGE) break;
    }
    return ids;
  }

  async dahuaRemoveUsers(
    device: FacialDeviceConfig,
    userIds: string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, {
        type: 'remove_users',
        faceIds: userIds,
      });
      if (!r.ok) {
        throw new Error(r.error ?? 'Falha ao remover pessoas via agente');
      }
      return;
    }

    const r = await this.send(
      device,
      'POST',
      '/RPC2',
      {
        method: 'UserInfo.removeMulti',
        params: {
          UserList: userIds.map((id) => ({ UserID: id })),
        },
      },
      'application/json',
    );
    const data = this.rpcData(r);
    if (!data || data.result === false) {
      throw new Error('Falha ao remover usuários via RPC2');
    }
  }

  private buildMultipart(
    parts: ({ name: string; json: unknown } | { name: string; jpeg: Buffer; filename?: string })[],
  ): { body: Buffer; contentType: string } {
    const boundary = '----clickbnd' + crypto.randomBytes(8).toString('hex');
    const chunks: Buffer[] = [];
    for (const p of parts) {
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      if ('json' in p) {
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\nContent-Type: application/json\r\n\r\n`));
        chunks.push(Buffer.from(JSON.stringify(p.json)));
      } else {
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename || 'face.jpg'}"\r\nContent-Type: image/jpeg\r\n\r\n`));
        chunks.push(p.jpeg);
      }
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
  }
}
