import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, Method } from 'axios';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { AgentBridgeService } from './agent-bridge.service';
import { agentesSemRedeInterna, lookupSeguro, urlExternaSegura } from '../common/url-segura.util';
import { FABRICANTE_GENERICO, protocoloSemHttp } from './fabricantes';

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

/** Por que o "Testar conexão" falhou (null = não falhou). */
export type MotivoDiagnostico =
  /** O Agente Local não está conectado e o terminal só é alcançável por ele. */
  | 'agente_offline'
  /** O aparelho respondeu 401/403: usuário ou senha errados. */
  | 'credencial_invalida'
  /** Ninguém respondeu no endereço (timeout / sem rota): IP errado, aparelho desligado. */
  | 'sem_resposta'
  /** Há um host no IP, mas a porta recusou a conexão: porta errada. */
  | 'recusado'
  /** Respondeu, mas não como a marca cadastrada responderia: provável marca errada. */
  | 'protocolo_inesperado'
  /** A marca não aceita comando HTTP (ver fabricantes.ts, família 'sem_http'). */
  | 'marca_sem_http';

export interface DiagnosticoConexao {
  ok: boolean;
  motivo: MotivoDiagnostico | null;
  /** Texto curto para o operador/suporte. Nunca contém a senha do aparelho. */
  detalhe?: string;
}

/** `motivo` que o Agente Local manda no resultado do ping → motivo da nuvem. */
const MOTIVOS_DO_AGENTE = new Map<string, MotivoDiagnostico>([
  ['credencial', 'credencial_invalida'],
  ['credencial_invalida', 'credencial_invalida'],
  ['sem_resposta', 'sem_resposta'],
  ['recusado', 'recusado'],
  ['protocolo_inesperado', 'protocolo_inesperado'],
]);

const DETALHE_MAX = 200;

/**
 * Deriva o motivo da falha a partir do que sobrou dela: o status HTTP do
 * aparelho, ou — sem status — o código/mensagem do erro de rede. Vale para o
 * modo direto e para o agente que ainda não manda `motivo`.
 */
export function motivoDaFalha(
  statusCode?: number | null,
  erro?: string | null,
  codigo?: string | null,
): MotivoDiagnostico {
  if (typeof statusCode === 'number' && Number.isFinite(statusCode)) {
    if (statusCode === 401 || statusCode === 403) return 'credencial_invalida';
    // 404/outro 4xx: o caminho da marca não existe ali. 2xx sem sucesso, 3xx
    // e 5xx: respondeu, mas não como a marca cadastrada responderia.
    return 'protocolo_inesperado';
  }
  const texto = `${codigo ?? ''} ${erro ?? ''}`;
  if (/ECONNREFUSED/i.test(texto)) return 'recusado';
  if (/agente local n.o est. conectado|resolve para endere.o interno/i.test(texto)) {
    return 'agente_offline';
  }
  if (/ECONNRESET|EPROTO|HPE_|parse error|socket hang up|wrong version number|n.o retornou session/i.test(texto)) {
    return 'protocolo_inesperado';
  }
  // timeout, ETIMEDOUT, EHOSTUNREACH, ENETUNREACH, ENOTFOUND, sem informação.
  return 'sem_resposta';
}

/**
 * Identificador que NÓS gravamos no aparelho ("morador_42", "visitante_9",
 * "prestador_servico_3", "pessoa_10"). Usado para a varredura de fantasmas não encostar em
 * usuários criados direto no aparelho pelo instalador. Ver listUserIds.
 */
const NOSSO_EXTERNAL_ID = /^(morador|visitante|prestador_servico|pessoa)_\d+$/;

/**
 * Fabricantes que NÃO falam HTTP para comandos (abrir porta / cadastrar rosto)
 * usam protocolo binário em porta própria ou SDK. A lista mora no registro de
 * fabricantes (fabricantes.ts, família 'sem_http'); aqui só se consulta, por
 * protocoloSemHttp().
 */

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
 *   - zkteco/topdata/henry: não usam HTTP (ver fabricantes.ts, família 'sem_http')
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

  /**
   * Endereço de rede interna só é alcançável pelo Agente Local. Na nuvem, o
   * modo direto chamaria a VPC da AWS, não a LAN do condomínio: qualquer
   * síndico cadastraria um "terminal" em 10.x/172.16.x e varreria a rede da
   * instância pelo "Testar conexão" (pentest P-05). On-premise e dev ligam
   * FACIAL_HTTP_DIRETO_REDE_INTERNA=true para falar com o aparelho da LAN.
   */
  private redeInternaLiberada(): boolean {
    return process.env.FACIAL_HTTP_DIRETO_REDE_INTERNA === 'true';
  }

  /** false = endereço de rede interna, só alcançável pelo Agente Local. */
  private async destinoPermitido(device: FacialDeviceConfig): Promise<boolean> {
    if (this.redeInternaLiberada()) return true;
    return urlExternaSegura(this.baseUrl(device));
  }

  private async exigirDestinoPermitido(device: FacialDeviceConfig): Promise<void> {
    if (!(await this.destinoPermitido(device))) {
      throw new Error(
        `Endereço do terminal (${device.ip}) é de rede interna: só o Agente Local alcança. Verifique se o agente está conectado.`,
      );
    }
  }

  /**
   * Opções de rede de toda chamada nuvem→terminal: sem seguir redirecionamento
   * (um 302 para endereço interno contornaria a checagem), sem proxy do
   * ambiente e com agentes que recusam conectar em IP interno também quando o
   * nome resolve diferente na hora da conexão (DNS rebinding). O HTTPS aceita
   * certificado self-signed, comum nos aparelhos.
   */
  private opcoesDeRede(): {
    maxRedirects: 0;
    proxy?: false;
    httpAgent?: http.Agent;
    httpsAgent: https.Agent;
  } {
    if (this.redeInternaLiberada()) {
      return { maxRedirects: 0, httpsAgent: new https.Agent({ rejectUnauthorized: false }) };
    }
    const { httpAgent, proxy } = agentesSemRedeInterna();
    return {
      maxRedirects: 0,
      proxy,
      httpAgent,
      httpsAgent: new https.Agent({ rejectUnauthorized: false, lookup: lookupSeguro as any }),
    };
  }

  /** Axios para Control iD: sem Basic auth (usa sessão na query). */
  private http(device: FacialDeviceConfig): AxiosInstance {
    const inst = axios.create({
      baseURL: this.baseUrl(device),
      timeout: this.timeoutMs,
      ...this.opcoesDeRede(),
    });
    inst.interceptors.request.use(async (cfg) => {
      await this.exigirDestinoPermitido(device);
      return cfg;
    });
    return inst;
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
    await this.exigirDestinoPermitido(device);
    const url = this.baseUrl(device) + path;
    const rede = this.opcoesDeRede();
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
      ...rede,
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
        ...rede,
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

  /** "Está alcançável?" — só o sim/não. O porquê está em {@link diagnosticar}. */
  async ping(device: FacialDeviceConfig): Promise<boolean> {
    return (await this.diagnosticar(device)).ok;
  }

  /**
   * Testa a conexão com o aparelho e, se falhar, diz POR QUÊ (ver
   * MotivoDiagnostico). Mesmo caminho que o ping sempre fez: simulador →
   * Agente Local (se online) → HTTP direto. Nunca lança.
   */
  async diagnosticar(device: FacialDeviceConfig): Promise<DiagnosticoConexao> {
    if (this.isSim(device)) return { ok: true, motivo: null };
    const semHttp = protocoloSemHttp(device.fabricante);
    const detalheSemHttp = `${device.fabricante} usa ${semHttp} — não aceita comando via HTTP.`;

    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, { type: 'ping' });
      if (r.ok) return { ok: true, motivo: null };
      if (semHttp) return this.falha(device, 'marca_sem_http', detalheSemHttp);
      // Agente novo já classifica a falha; o antigo só manda statusCode/error.
      const doAgente = typeof r.motivo === 'string' ? MOTIVOS_DO_AGENTE.get(r.motivo) : undefined;
      return this.falha(
        device,
        doAgente ?? motivoDaFalha(r.statusCode, r.error),
        r.error ?? (typeof r.statusCode === 'number' ? `HTTP ${r.statusCode}` : undefined),
      );
    }

    if (semHttp) return this.falha(device, 'marca_sem_http', detalheSemHttp);
    try {
      if (!(await this.destinoPermitido(device))) {
        return this.falha(
          device,
          'agente_offline',
          `Agente Local não está conectado e o endereço do terminal (${device.ip}) é de rede interna: só o agente alcança.`,
        );
      }
      // Control iD não tem /status: um login bem-sucedido prova conectividade.
      if (device.fabricante === 'control_id') {
        await this.controlIdLogin(device);
        return { ok: true, motivo: null };
      }
      // Intelbras SS (Dahua): cgi com Digest prova conectividade SEM criar uma
      // sessão RPC2 (que vazaria e estouraria "too many connections" no aparelho).
      const caminho =
        device.fabricante === 'intelbras'
          ? '/cgi-bin/magicBox.cgi?action=getDeviceType'
          : device.fabricante === 'hikvision'
            ? '/ISAPI/System/deviceInfo'
            : '/status';
      const res = await this.send(device, 'GET', caminho);
      if (res.status >= 200 && res.status < 300) return { ok: true, motivo: null };
      return this.falha(device, motivoDaFalha(res.status), `HTTP ${res.status}`);
    } catch (err: any) {
      this.logger.warn(
        `Ping falhou no device ${device.id} (${device.ip}): ${err?.message ?? err}`,
      );
      const status: number | undefined = err?.response?.status;
      return this.falha(
        device,
        motivoDaFalha(status, err?.message, err?.code),
        typeof status === 'number' ? `HTTP ${status}` : String(err?.message ?? err),
      );
    }
  }

  private falha(
    device: FacialDeviceConfig,
    motivo: MotivoDiagnostico,
    detalhe?: string,
  ): DiagnosticoConexao {
    const limpo = detalhe ? this.semSegredo(device, detalhe) : '';
    return limpo ? { ok: false, motivo, detalhe: limpo } : { ok: false, motivo };
  }

  /**
   * O detalhe do diagnóstico vai para a tela: tira a senha do aparelho em
   * todas as formas em que ela poderia aparecer num erro (crua, na URL, no
   * header Basic/Digest) e corta o texto.
   */
  private semSegredo(device: FacialDeviceConfig, texto: string): string {
    let s = String(texto);
    const senha = device.api_password ?? '';
    if (senha) {
      const formas = new Set<string>([
        senha,
        encodeURIComponent(senha),
        Buffer.from(senha).toString('base64'),
        Buffer.from(`${device.api_user ?? ''}:${senha}`).toString('base64'),
      ]);
      // Mais longas primeiro: a forma codificada pode conter a crua.
      for (const f of [...formas].sort((a, b) => b.length - a.length)) s = s.split(f).join('***');
    }
    s = s
      .replace(/\b(Basic|Digest|Bearer)\s+[^\n)]*/gi, '$1 ***')
      .replace(/\/\/[^/\s:@]*:[^@\s]*@/g, '//***@')
      .replace(/\b(password|passwd|senha|pass|session)=[^&\s]*/gi, '$1=***');
    return s.trim().slice(0, DETALHE_MAX);
  }

  /**
   * Endpoints de "abrir porta/catraca" por fabricante que falam HTTP (modo
   * DIRETO). control_id é tratado à parte (sessão). zkteco/topdata/henry não
   * entram aqui — não usam HTTP (ver fabricantes.ts, família 'sem_http').
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
    [FABRICANTE_GENERICO]: { method: 'POST', path: '/open_door' },
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
    if (protocoloSemHttp(device.fabricante)) {
      return {
        ok: false,
        error: `${device.fabricante} usa ${protocoloSemHttp(device.fabricante)} — não aceita acionamento via HTTP. Use uma botoeira/relé HTTP genérico ou um bridge SDK.`,
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
        this.relayEndpoints[FABRICANTE_GENERICO];
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

    if (protocoloSemHttp(device.fabricante)) {
      throw new Error(
        `${device.fabricante} usa ${protocoloSemHttp(device.fabricante)} — cadastro de rosto não é possível via HTTP direto. Use o Agente Local com bridge SDK.`,
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

    if (protocoloSemHttp(device.fabricante)) {
      throw new Error(
        `${device.fabricante} usa ${protocoloSemHttp(device.fabricante)} — atualização de rosto não é possível via HTTP direto.`,
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

    if (protocoloSemHttp(device.fabricante)) return; // nada a fazer via HTTP
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
          // UseTime só é aplicado pelo firmware quando UserType=2 (Guest).
          // Tabela Dahua: 0=geral, 1=blocklist, 2=convidado, 3=ronda, 4=VIP.
          UserType: typeof userTimes === 'number' && userTimes > 0 ? 2 : 0,
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

  /**
   * Lista os identificadores de pessoa gravados no aparelho — base da varredura
   * de fantasmas biométricos. O id devolvido é sempre o mesmo que gravamos em
   * `face_id` no enrollment: UserID (Intelbras), employeeNo (Hikvision) ou o id
   * interno do usuário (Control iD).
   *
   * Em Hikvision e Control iD a lista é restrita às pessoas que NÓS
   * cadastramos (ver NOSSO_EXTERNAL_ID) — senão a varredura apagaria o usuário
   * admin criado pelo instalador no próprio aparelho, trancando-o para fora.
   * Intelbras mantém o comportamento atual (varre tudo), já rodando em produção.
   */
  async listUserIds(device: FacialDeviceConfig): Promise<string[]> {
    if (this.agent.isOnline(device.id)) {
      const r = await this.agent.enqueue(device.id, { type: 'list_users' });
      if (!r.ok) {
        throw new Error(r.error ?? 'Falha ao listar pessoas via agente');
      }
      return (r as any).userIds || [];
    }

    if (device.fabricante === 'hikvision') {
      const ids: string[] = [];
      const PAGE = 50;
      let pos = 0;
      for (;;) {
        const resp = await this.send(
          device,
          'POST',
          '/ISAPI/AccessControl/UserInfo/Search?format=json',
          {
            UserInfoSearchCond: {
              searchID: 'click-list-users',
              searchResultPosition: pos,
              maxResults: PAGE,
            },
          },
          'application/json',
        );
        if (!(resp.status >= 200 && resp.status < 300)) {
          throw new Error(`Hikvision: falha ao listar usuários (HTTP ${resp.status})`);
        }
        const search = (resp.data as any)?.UserInfoSearch ?? {};
        const list = search.UserInfo ?? [];
        for (const u of list) {
          if (u.employeeNo && NOSSO_EXTERNAL_ID.test(String(u.employeeNo))) {
            ids.push(String(u.employeeNo));
          }
        }
        // Pagina sobre TODOS (inclusive os filtrados): parar cedo deixaria
        // fantasmas nas páginas seguintes.
        pos += list.length;
        if (list.length === 0 || search.responseStatusStrg !== 'MORE') break;
      }
      return ids;
    }

    if (device.fabricante === 'control_id') {
      const session = await this.controlIdLogin(device);
      const resp = await this.http(device).post(
        `/load_objects.fcgi?session=${session}`,
        { object: 'users' },
      );
      // Quem identifica os NOSSOS usuários no Control iD é o `registration`
      // (o id interno é indistinguível de um usuário criado no aparelho).
      const users = (resp.data as any)?.users ?? [];
      return users
        .filter(
          (u: any) =>
            u.id != null && NOSSO_EXTERNAL_ID.test(String(u.registration ?? '')),
        )
        .map((u: any) => String(u.id));
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

  /** Remove em lote os identificadores listados por {@link listUserIds}. */
  async removeUsers(
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

    // Sem remoção em lote nessas marcas: cai para o caminho individual já
    // validado. Falha isolada não aborta o lote — a varredura roda de hora em
    // hora e reprocessa o que sobrou.
    if (device.fabricante === 'hikvision' || device.fabricante === 'control_id') {
      const falhas: string[] = [];
      for (const faceId of userIds) {
        try {
          await this.removePerson(device, faceId);
        } catch {
          falhas.push(faceId);
        }
      }
      if (falhas.length > 0) {
        throw new Error(
          `Falha ao remover ${falhas.length}/${userIds.length} usuário(s): ${falhas.slice(0, 10).join(', ')}`,
        );
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
