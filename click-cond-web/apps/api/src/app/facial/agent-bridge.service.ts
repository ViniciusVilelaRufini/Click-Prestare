import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';

/**
 * Ponte entre a nuvem e o "Agente Local" instalado na LAN do condomínio.
 *
 * PROBLEMA QUE RESOLVE
 * --------------------
 * O backend roda na nuvem (Railway). Os dispositivos (facial/catraca/botoeira)
 * ficam na rede local do condomínio com IP privado (ex.: 192.168.1.50), que
 * NÃO é roteável pela internet. A nuvem não consegue abrir uma conexão direta
 * até o aparelho.
 *
 * SOLUÇÃO (outbound polling)
 * --------------------------
 * Um agente leve roda numa máquina sempre-ligada do condomínio. Ele conecta
 * PARA FORA (nuvem → não precisa liberar porta no roteador), faz polling de
 * comandos pendentes, executa no aparelho da LAN e devolve o resultado.
 *
 *   Operador clica "Acionar" → FacialService → AgentBridge.enqueue(...)
 *     → comando entra na fila do device
 *   Agente faz GET /facial/agent/:token/poll → recebe o comando
 *     → executa http://192.168.1.50/... na LAN
 *     → POST /facial/agent/:token/result com o resultado
 *   enqueue() resolve a Promise com o resultado (ou timeout)
 *
 * ESTADO EM MEMÓRIA
 * -----------------
 * Mesma decisão do MockRelayService/EnrollSessionService: comandos são
 * efêmeros ("abra agora", "cadastre agora"), então não vale persistir. Se o
 * backend reiniciar, comandos em voo são perdidos e o operador refaz a ação.
 * O agente apenas volta a fazer polling — não precisa de re-registro.
 */
@Injectable()
export class AgentBridgeService {
  private readonly logger = new Logger(AgentBridgeService.name);

  /** Janela em que o device é considerado "online" desde o último poll. */
  private readonly onlineTtlMs = Number(
    process.env.AGENT_ONLINE_TTL_MS ?? 45_000,
  );
  /** Quanto a nuvem espera o agente responder antes de desistir do comando. */
  private readonly commandTimeoutMs = Number(
    process.env.AGENT_COMMAND_TIMEOUT_MS ?? 15_000,
  );
  /** Intervalo sugerido de polling enviado ao agente. */
  readonly pollIntervalMs = Number(process.env.AGENT_POLL_INTERVAL_MS ?? 2_000);

  /** Janela para considerar o status do APARELHO (na LAN) ainda recente. */
  private readonly deviceStatusTtlMs = Number(
    process.env.AGENT_DEVICE_STATUS_TTL_MS ?? 60_000,
  );

  /** deviceId → timestamp do último poll (heartbeat). */
  private readonly lastSeen = new Map<number, number>();
  /** deviceId → status do aparelho na LAN reportado pelo agente (ping periódico). */
  private readonly deviceStatus = new Map<
    number,
    { online: boolean; at: number }
  >();
  /** deviceId → timestamp de quando o aparelho ficou offline. */
  private readonly deviceOfflineSince = new Map<number, number>();
  /** deviceId → se já abriu ocorrência para esta queda offline. */
  private readonly deviceTicketOpened = new Map<number, boolean>();
  /** commandId → comando aguardando resposta. */
  private readonly pending = new Map<string, PendingCommand>();
  /** deviceId → fila de commandIds ainda não entregues no poll. */
  private readonly queue = new Map<number, string[]>();
  /** idCondominio → última telemetria recebida do Agente Local (tarefa 7). */
  private readonly telemetria = new Map<number, AgentTelemetria>();

  /** Registra que o agente desse device fez polling agora. */
  heartbeat(deviceId: number): void {
    this.lastSeen.set(deviceId, Date.now());
  }

  /** True se um agente fez poll deste device dentro da janela de TTL. */
  isOnline(deviceId: number): boolean {
    const t = this.lastSeen.get(deviceId);
    return t !== undefined && Date.now() - t < this.onlineTtlMs;
  }

  /** Timestamp (ms) do último poll do agente para este device, ou null se nunca visto (desde o último boot). */
  lastSeenAt(deviceId: number): number | null {
    return this.lastSeen.get(deviceId) ?? null;
  }

  /** Agente reportou o status do aparelho (alcançável ou não) na LAN. */
  reportDeviceStatus(deviceId: number, online: boolean): { 
    changed: boolean; 
    previous: boolean | null;
    shouldOpenTicket: boolean;
    shouldResolveTicket: boolean;
  } {
    const prev = this.deviceStatus.get(deviceId);
    const lastKnownOnline = prev ? prev.online : null;
    
    this.deviceStatus.set(deviceId, { online, at: Date.now() });

    let shouldOpenTicket = false;
    let shouldResolveTicket = false;

    if (online) {
      this.deviceOfflineSince.delete(deviceId);
      if (this.deviceTicketOpened.get(deviceId)) {
        this.deviceTicketOpened.delete(deviceId);
        shouldResolveTicket = true;
      }
    } else {
      if (!this.deviceOfflineSince.has(deviceId)) {
        this.deviceOfflineSince.set(deviceId, Date.now());
      } else {
        const offlineSince = this.deviceOfflineSince.get(deviceId)!;
        const offlineDuration = Date.now() - offlineSince;
        if (offlineDuration >= 10 * 60 * 1000 && !this.deviceTicketOpened.get(deviceId)) {
          this.deviceTicketOpened.set(deviceId, true);
          shouldOpenTicket = true;
        }
      }
    }

    // Só considera alterado se tinha status anterior conhecido e ele mudou
    const changed = lastKnownOnline !== null ? (lastKnownOnline !== online) : false;

    return {
      changed,
      previous: lastKnownOnline,
      shouldOpenTicket,
      shouldResolveTicket,
    };
  }

  /**
   * Status do APARELHO: true=online, false=offline (reporte recente do agente),
   * null=desconhecido (sem reporte recente — ex.: agente caiu). Diferente de
   * isOnline(), que é sobre o AGENTE estar fazendo polling.
   */
  isDeviceOnline(deviceId: number): boolean | null {
    const s = this.deviceStatus.get(deviceId);
    if (!s || Date.now() - s.at >= this.deviceStatusTtlMs) return null;
    return s.online;
  }

  /**
   * Enfileira um comando para o agente e devolve uma Promise que resolve
   * quando o agente reporta o resultado — ou com {ok:false} se o agente não
   * estiver online ou estourar o timeout. NUNCA rejeita: o chamador decide o
   * que fazer com ok=false (ex.: trigger registra falha auditável).
   */
  enqueue(deviceId: number, command: AgentCommandInput): Promise<AgentResult> {
    if (!this.isOnline(deviceId)) {
      return Promise.resolve({
        ok: false,
        error: 'Agente local não está conectado para este dispositivo.',
      });
    }

    const id = randomBytes(8).toString('hex');
    return new Promise<AgentResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.logger.warn(
          `Comando ${id} (${command.type}) device ${deviceId} expirou sem resposta do agente`,
        );
        resolve({
          ok: false,
          error: 'Tempo esgotado: o agente local não respondeu.',
        });
      }, this.commandTimeoutMs);

      this.pending.set(id, {
        command: { ...command, id },
        deviceId,
        resolve,
        timer,
      });
      const q = this.queue.get(deviceId) ?? [];
      q.push(id);
      this.queue.set(deviceId, q);
    });
  }

  /**
   * Chamado pelo agente. Marca heartbeat e drena a fila de comandos do device.
   * Os comandos continuam em `pending` aguardando o resultado.
   */
  poll(deviceId: number): AgentCommand[] {
    this.heartbeat(deviceId);
    const ids = this.queue.get(deviceId) ?? [];
    this.queue.set(deviceId, []);
    const cmds: AgentCommand[] = [];
    for (const id of ids) {
      const p = this.pending.get(id);
      if (p) cmds.push(p.command);
    }
    return cmds;
  }

  /** Chamado pelo agente para reportar o resultado de um comando. */
  submitResult(commandId: string, result: AgentResult): void {
    const p = this.pending.get(commandId);
    if (!p) return; // já expirou ou desconhecido — ignora
    clearTimeout(p.timer);
    this.pending.delete(commandId);
    p.resolve(result);
  }

  /**
   * Chamado pelo agente (POST condo/:token/telemetria, ~1x/min) para
   * atualizar o retrato de saúde do condomínio: versão, SO, saúde por
   * device e fila offline pendente. Em memória, como o resto desta classe
   * (ver comentário "ESTADO EM MEMÓRIA" acima) — reiniciar o backend só
   * apaga a última foto, o agente manda outra no próximo ciclo.
   *
   * `payload` é `unknown` de propósito: a rota é `@Public()` (autenticada só
   * pelo token do device, sem JWT) e `@SkipThrottle()`, sob o limite global de
   * body (50MB) — `AgentTelemetriaPayload` é só um tipo do TypeScript, apagado
   * em tempo de execução, então sem `sanitizarTelemetria()` um payload
   * malicioso ou de um agente com bug ficaria neste Map do jeito que chegou
   * (string gigante, array enorme, campos a mais). Sanitiza SEMPRE, aqui
   * dentro — não depende do chamador lembrar de sanitizar antes de chamar.
   */
  setTelemetria(idCondominio: number, payload: unknown): void {
    this.telemetria.set(idCondominio, {
      recebido_em: new Date().toISOString(),
      ...sanitizarTelemetria(payload),
    });
  }

  /** Última telemetria do condomínio, ou null se o agente nunca reportou. */
  getTelemetria(idCondominio: number): AgentTelemetria | null {
    return this.telemetria.get(idCondominio) ?? null;
  }
}

export type AgentCommandType =
  | 'ping'
  | 'open_door'
  | 'enroll'
  | 'update'
  | 'remove'
  | 'snapshot'
  | 'list_users'
  | 'remove_users';

export interface AgentCommandInput {
  type: AgentCommandType;
  externalId?: string;
  nome?: string;
  fotoBase64?: string;
  faceId?: string;
  faceIds?: string[];
  /** Validade no aparelho (Dahua "YYYY-MM-DD HH:MM:SS"). Default = permanente. */
  validFrom?: string;
  validTo?: string;
  userTimes?: number;
}

export interface AgentCommand extends AgentCommandInput {
  id: string;
}

export interface AgentResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  faceId?: string;
  /** JPEG em base64 (resposta do comando 'snapshot'). */
  imageBase64?: string;
}

interface PendingCommand {
  command: AgentCommand;
  deviceId: number;
  resolve: (r: AgentResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Saúde de UM device, no formato que a telemetria do agente monta
 *  (agent/src/core/telemetria.js): `online` = último heartbeat (ping) do
 *  aparelho; `ouvinte_ativo` = a assinatura de eventos faciais está aberta
 *  (sempre false para device sem ouvinte — LPR, catraca...). */
export interface AgentTelemetriaDispositivo {
  id: number;
  driver: string | null;
  online: boolean;
  ouvinte_ativo: boolean;
  ultimo_evento_em: string | null;
  ultimo_erro: string | null;
}

/** Corpo de POST condo/:token/telemetria (ver agent/src/core/telemetria.js). */
export interface AgentTelemetriaPayload {
  versao: string;
  so: string;
  iniciado_em: string;
  dispositivos: AgentTelemetriaDispositivo[];
  eventos_pendentes: number;
}

/** O que fica guardado por condomínio: o payload do agente + quando chegou. */
export interface AgentTelemetria extends AgentTelemetriaPayload {
  recebido_em: string;
}

// ----- Sanitização de POST condo/:token/telemetria (entrada não confiável) -----

const TELEMETRIA_MAX_VERSAO = 32;
const TELEMETRIA_MAX_SO = 100;
const TELEMETRIA_MAX_INICIADO_EM = 40;
const TELEMETRIA_MAX_DISPOSITIVOS = 200;
const TELEMETRIA_MAX_DRIVER = 40;
const TELEMETRIA_MAX_ULTIMO_EVENTO_EM = 40;
const TELEMETRIA_MAX_ULTIMO_ERRO = 500;

function strTruncada(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function strOuNull(v: unknown, max: number): string | null {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

/** Um device da telemetria: só entra com `id` numérico — sem ele não dá para casar com o dispositivo no portal. */
function sanitizarDispositivo(v: unknown): AgentTelemetriaDispositivo | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as Record<string, unknown>;
  if (typeof d['id'] !== 'number' || !Number.isFinite(d['id'])) return null;
  return {
    id: d['id'],
    driver: strOuNull(d['driver'], TELEMETRIA_MAX_DRIVER),
    online: d['online'] === true,
    ouvinte_ativo: d['ouvinte_ativo'] === true,
    ultimo_evento_em: strOuNull(d['ultimo_evento_em'], TELEMETRIA_MAX_ULTIMO_EVENTO_EM),
    ultimo_erro: strOuNull(d['ultimo_erro'], TELEMETRIA_MAX_ULTIMO_ERRO),
  };
}

/**
 * Sanitiza o corpo de POST condo/:token/telemetria ANTES de guardar: monta um
 * objeto NOVO só com os campos esperados, no tipo e tamanho certos — qualquer
 * coisa a mais é descartada, qualquer coisa do tipo errado vira o default
 * seguro (nunca lança). Ver `setTelemetria()` para o porquê (rota pública,
 * sem rate-limit, sob o limite genérico de body).
 */
export function sanitizarTelemetria(raw: unknown): AgentTelemetriaPayload {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const eventosPendentes = Number(body['eventos_pendentes']);
  const dispositivosBrutos = Array.isArray(body['dispositivos']) ? body['dispositivos'] : [];
  const dispositivos = dispositivosBrutos
    .slice(0, TELEMETRIA_MAX_DISPOSITIVOS)
    .map(sanitizarDispositivo)
    .filter((d): d is AgentTelemetriaDispositivo => d !== null);
  return {
    versao: strTruncada(body['versao'], TELEMETRIA_MAX_VERSAO),
    so: strTruncada(body['so'], TELEMETRIA_MAX_SO),
    iniciado_em: strTruncada(body['iniciado_em'], TELEMETRIA_MAX_INICIADO_EM),
    eventos_pendentes: Number.isFinite(eventosPendentes) && eventosPendentes >= 0 ? eventosPendentes : 0,
    dispositivos,
  };
}
