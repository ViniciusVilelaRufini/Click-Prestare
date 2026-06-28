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

  /** Registra que o agente desse device fez polling agora. */
  heartbeat(deviceId: number): void {
    this.lastSeen.set(deviceId, Date.now());
  }

  /** True se um agente fez poll deste device dentro da janela de TTL. */
  isOnline(deviceId: number): boolean {
    const t = this.lastSeen.get(deviceId);
    return t !== undefined && Date.now() - t < this.onlineTtlMs;
  }

  /** Agente reportou o status do aparelho (alcançável ou não) na LAN. */
  reportDeviceStatus(deviceId: number, online: boolean): { 
    changed: boolean; 
    previous: boolean | null;
    shouldOpenTicket: boolean;
    shouldResolveTicket: boolean;
  } {
    const prev = this.deviceStatus.get(deviceId);
    const prevOnline = prev && (Date.now() - prev.at < this.deviceStatusTtlMs) ? prev.online : null;
    
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

    return {
      changed: prevOnline !== online,
      previous: prevOnline,
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
