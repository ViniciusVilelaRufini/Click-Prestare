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

  /** deviceId → timestamp do último poll (heartbeat). */
  private readonly lastSeen = new Map<number, number>();
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
  | 'remove';

export interface AgentCommandInput {
  type: AgentCommandType;
  externalId?: string;
  nome?: string;
  fotoBase64?: string;
  faceId?: string;
}

export interface AgentCommand extends AgentCommandInput {
  id: string;
}

export interface AgentResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  faceId?: string;
}

interface PendingCommand {
  command: AgentCommand;
  deviceId: number;
  resolve: (r: AgentResult) => void;
  timer: ReturnType<typeof setTimeout>;
}
