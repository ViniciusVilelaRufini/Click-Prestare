import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';

/**
 * Ponte entre a nuvem e o "Agente Local" instalado na LAN do condomínio.
 *
 * PROBLEMA QUE RESOLVE
 * --------------------
 * O backend roda na nuvem. Os dispositivos (facial/catraca/botoeira) ficam na
 * rede local do condomínio com IP privado (ex.: 192.168.1.50), que NÃO é
 * roteável pela internet. A nuvem não consegue abrir uma conexão direta até o
 * aparelho.
 *
 * SOLUÇÃO (outbound polling)
 * --------------------------
 * Um agente leve roda numa máquina sempre-ligada do condomínio. Ele conecta
 * PARA FORA (nuvem → não precisa liberar porta no roteador), faz polling de
 * comandos pendentes, executa no aparelho da LAN e devolve o resultado.
 *
 *   Operador clica "Acionar" → FacialService → AgentBridge.enqueue(...)
 *     → comando entra na fila do device (tabela agente_comandos)
 *   Agente faz GET /facial/agent/:token/poll → recebe o comando
 *     → executa http://192.168.1.50/... na LAN
 *     → POST /facial/agent/:token/result com o resultado
 *   enqueue() resolve a Promise com o resultado (ou timeout)
 *
 * VÁRIAS INSTÂNCIAS
 * -----------------
 * A API roda em 2 instâncias atrás do ALB: o operador enfileira numa e o
 * agente faz poll (e devolve o resultado) em qualquer uma. Por isso a fila de
 * comandos, o último poll e o status do aparelho moram no banco
 * (agente_comandos, agente_dispositivos_estado) e a telemetria em
 * estado_compartilhado. A instância que enfileirou espera o resultado
 * consultando a tabela a cada RESULTADO_POLL_MS (uma query para todos os
 * comandos em espera). `isOnline`/`isDeviceOnline` continuam síncronos: leem
 * um cache local atualizado do banco a cada CACHE_REFRESH_MS.
 *
 * Sem banco (modo offline / testes sem Prisma) tudo fica em memória, como
 * antes. Comandos continuam efêmeros: expiram em segundos e a faxina apaga.
 */
const RESULTADO_POLL_MS = 300;
const CACHE_REFRESH_MS = 5_000;
/** Heartbeat no banco no máximo a cada X por device (o agente faz poll a cada 2s). */
const HEARTBEAT_GRAVA_A_CADA_MS = 10_000;
const FAXINA_MS = 60_000;
const TELEMETRIA_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AgentBridgeService implements OnModuleDestroy {
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

  /** deviceId → timestamp do último poll (heartbeat). Cache do banco quando há banco. */
  private readonly lastSeen = new Map<number, number>();
  /** deviceId → quando ESTA instância gravou o heartbeat no banco pela última vez. */
  private readonly heartbeatGravadoEm = new Map<number, number>();
  /** deviceId → status do aparelho na LAN reportado pelo agente (ping periódico). */
  private readonly deviceStatus = new Map<
    number,
    { online: boolean; at: number }
  >();
  /** deviceId → timestamp de quando o aparelho ficou offline (modo memória). */
  private readonly deviceOfflineSince = new Map<number, number>();
  /** deviceId → se já abriu ocorrência para esta queda offline (modo memória). */
  private readonly deviceTicketOpened = new Map<number, boolean>();
  /** commandId → comando aguardando resposta (enfileirado POR ESTA instância). */
  private readonly pending = new Map<string, PendingCommand>();
  /** deviceId → fila de commandIds ainda não entregues no poll (modo memória). */
  private readonly queue = new Map<number, string[]>();
  /** idCondominio → última telemetria recebida do Agente Local (tarefa 7). */
  private readonly estado: EstadoCompartilhado;

  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private conferindoResultados = false;

  constructor(@Optional() private readonly prisma?: PrismaService) {
    this.estado = new EstadoCompartilhado(prisma);
    if (prisma) {
      this.timers.push(setInterval(() => void this.conferirResultados(), RESULTADO_POLL_MS));
      this.timers.push(setInterval(() => void this.atualizarCache(), CACHE_REFRESH_MS));
      this.timers.push(setInterval(() => void this.faxina(), FAXINA_MS));
      // Sem unref, specs que instanciam o serviço com Prisma deixariam o Jest pendurado.
      for (const t of this.timers) t.unref?.();
    }
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
  }

  /**
   * true depois que o banco respondeu "tabela não existe" (SQL
   * 2026-11-04-multi-instancia.sql ainda não aplicado). Daí em diante esta
   * instância usa a fila/estado em memória — o comportamento de antes, que
   * funciona com UMA instância. Mesmo padrão do EstadoCompartilhado.
   */
  private tabelasAusentes = false;

  /** Banco disponível e com as tabelas do modelo (Prisma falso de teste não tem). */
  private get db(): any | null {
    const p: any = this.prisma;
    if (this.tabelasAusentes) return null;
    if (!p || !p.isConnected || !p.agente_Comandos || !p.agente_Dispositivos_Estado) return null;
    return p;
  }

  /**
   * Erro de "tabela não existe" (Prisma P2021 / MySQL 1146)? Liga o modo
   * memória e loga ERROR uma vez só. Devolve true para o chamador cair no
   * caminho em memória; false = erro de outra natureza.
   */
  private tabelaAusente(err: any): boolean {
    const codigo = err?.code;
    const msg = String(err?.message ?? '');
    const ausente =
      codigo === 'P2021' || codigo === 'ER_NO_SUCH_TABLE' || /1146|does(?: not|n't) exist/i.test(msg);
    if (!ausente) return false;
    if (!this.tabelasAusentes) {
      this.tabelasAusentes = true;
      this.logger.error(
        'Tabelas agente_comandos/agente_dispositivos_estado não existem — aplicar prisma/sql/2026-11-04-multi-instancia.sql. ' +
          'Usando fila em memória (funciona com UMA instância; NÃO é seguro com mais de uma).',
      );
    }
    return true;
  }

  /** Registra que o agente desse device fez polling agora. */
  heartbeat(deviceId: number): void {
    const agora = Date.now();
    this.lastSeen.set(deviceId, agora);
    const db = this.db;
    if (!db) return;
    const ultima = this.heartbeatGravadoEm.get(deviceId) ?? 0;
    if (agora - ultima < HEARTBEAT_GRAVA_A_CADA_MS) return;
    this.heartbeatGravadoEm.set(deviceId, agora);
    const em = new Date(agora);
    db.agente_Dispositivos_Estado
      .upsert({
        where: { id_device: deviceId },
        create: { id_device: deviceId, ultimo_poll_em: em },
        update: { ultimo_poll_em: em },
      })
      .catch((err: any) => {
        this.heartbeatGravadoEm.delete(deviceId);
        if (this.tabelaAusente(err)) return;
        this.logger.warn(`Heartbeat do device ${deviceId} não gravou: ${err?.message ?? err}`);
      });
  }

  /** True se um agente fez poll deste device dentro da janela de TTL (em qualquer instância). */
  isOnline(deviceId: number): boolean {
    const t = this.lastSeen.get(deviceId);
    return t !== undefined && Date.now() - t < this.onlineTtlMs;
  }

  /** Timestamp (ms) do último poll do agente para este device, ou null se nunca visto. */
  lastSeenAt(deviceId: number): number | null {
    return this.lastSeen.get(deviceId) ?? null;
  }

  /**
   * Agente reportou o status do aparelho (alcançável ou não) na LAN. A
   * máquina de estados (offline há 10 min → abre ocorrência uma vez) fica no
   * banco: o agente reporta em instâncias alternadas e, com o estado em cada
   * processo, as duas abririam (ou nenhuma abriria) a ocorrência.
   */
  async reportDeviceStatus(deviceId: number, online: boolean): Promise<{
    changed: boolean;
    previous: boolean | null;
    shouldOpenTicket: boolean;
    shouldResolveTicket: boolean;
  }> {
    const db = this.db;
    if (!db) return this.reportDeviceStatusEmMemoria(deviceId, online);
    try {
      return await this.reportDeviceStatusNoBanco(db, deviceId, online);
    } catch (err: any) {
      if (this.tabelaAusente(err)) return this.reportDeviceStatusEmMemoria(deviceId, online);
      throw err;
    }
  }

  private async reportDeviceStatusNoBanco(db: any, deviceId: number, online: boolean) {
    const agora = Date.now();
    const linha = await db.agente_Dispositivos_Estado.findUnique({ where: { id_device: deviceId } });
    const lastKnownOnline =
      linha?.aparelho_online === null || linha?.aparelho_online === undefined ? null : linha.aparelho_online === 1;
    let offlineDesde: Date | null = linha?.offline_desde ? new Date(linha.offline_desde) : null;
    let ticketAberto = linha?.ticket_aberto === 1;
    let shouldOpenTicket = false;
    let shouldResolveTicket = false;

    if (online) {
      offlineDesde = null;
      if (ticketAberto) {
        ticketAberto = false;
        shouldResolveTicket = true;
      }
    } else if (!offlineDesde) {
      offlineDesde = new Date(agora);
    } else if (agora - offlineDesde.getTime() >= 10 * 60 * 1000 && !ticketAberto) {
      ticketAberto = true;
      shouldOpenTicket = true;
    }

    const dados = {
      aparelho_online: online ? 1 : 0,
      aparelho_status_em: new Date(agora),
      offline_desde: offlineDesde,
      ticket_aberto: ticketAberto ? 1 : 0,
    };
    if (shouldOpenTicket || shouldResolveTicket) {
      // Transição de ocorrência: UPDATE condicional para que só UM reporte
      // concorrente (duas instâncias ao mesmo tempo) abra/resolva o ticket.
      const r = await db.agente_Dispositivos_Estado.updateMany({
        where: { id_device: deviceId, ticket_aberto: shouldOpenTicket ? 0 : 1 },
        data: dados,
      });
      if (Number(r?.count ?? 0) !== 1) {
        shouldOpenTicket = false;
        shouldResolveTicket = false;
      }
    } else {
      await db.agente_Dispositivos_Estado.upsert({
        where: { id_device: deviceId },
        create: { id_device: deviceId, ...dados },
        update: dados,
      });
    }
    this.deviceStatus.set(deviceId, { online, at: agora });

    return {
      changed: lastKnownOnline !== null ? lastKnownOnline !== online : false,
      previous: lastKnownOnline,
      shouldOpenTicket,
      shouldResolveTicket,
    };
  }

  private reportDeviceStatusEmMemoria(deviceId: number, online: boolean) {
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
    const db = this.db;
    return new Promise<AgentResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.logger.warn(
          `Comando ${id} (${command.type}) device ${deviceId} expirou sem resposta do agente`,
        );
        // Não entregue ainda? Some da fila — o agente não executa um comando
        // que a nuvem já deu como perdido (ex.: abrir a porta 1 min depois).
        db?.agente_Comandos.deleteMany({ where: { id, status: 'pendente' } }).catch(() => undefined);
        resolve({
          ok: false,
          error: 'Tempo esgotado: o agente local não respondeu.',
        });
      }, this.commandTimeoutMs);

      const pendente: PendingCommand = {
        command: { ...command, id },
        deviceId,
        resolve,
        timer,
      };
      this.pending.set(id, pendente);

      const naFilaEmMemoria = () => {
        const q = this.queue.get(deviceId) ?? [];
        q.push(id);
        this.queue.set(deviceId, q);
      };
      if (!db) {
        naFilaEmMemoria();
        return;
      }
      db.agente_Comandos
        .create({
          data: {
            id,
            id_device: deviceId,
            comando: JSON.stringify(pendente.command),
            status: 'pendente',
            expira_em: new Date(Date.now() + this.commandTimeoutMs),
          },
        })
        .catch((err: any) => {
          // SQL não aplicado: o comando vai para a fila em memória e o poll
          // (que também cai para memória) entrega — a porta abre igual.
          if (this.tabelaAusente(err)) {
            if (this.pending.has(id)) naFilaEmMemoria();
            return;
          }
          this.logger.error(`Comando ${id} não entrou na fila do banco: ${err?.message ?? err}`);
          this.finalizar(id, { ok: false, error: 'Falha ao enfileirar o comando para o agente local.' });
        });
    });
  }

  /**
   * Chamado pelo agente. Marca heartbeat e drena a fila de comandos do device.
   * Os comandos continuam em `pending` (na instância que enfileirou)
   * aguardando o resultado.
   */
  async poll(deviceId: number): Promise<AgentCommand[]> {
    this.heartbeat(deviceId);
    const db = this.db;
    // Sempre drena a fila em memória: é onde caem os comandos quando não há
    // banco ou quando as tabelas ainda não existem.
    const ids = this.queue.get(deviceId) ?? [];
    this.queue.set(deviceId, []);
    const cmds: AgentCommand[] = [];
    for (const id of ids) {
      const p = this.pending.get(id);
      if (p) cmds.push(p.command);
    }
    if (!db) return cmds;
    try {
      return [...cmds, ...(await this.pollNoBanco(db, deviceId))];
    } catch (err: any) {
      if (this.tabelaAusente(err)) return cmds;
      throw err;
    }
  }

  private async pollNoBanco(db: any, deviceId: number): Promise<AgentCommand[]> {
    const linhas: Array<{ id: string; comando: string }> = await db.agente_Comandos.findMany({
      where: { id_device: deviceId, status: 'pendente', expira_em: { gt: new Date() } },
      orderBy: { criado_em: 'asc' },
      select: { id: true, comando: true },
    });
    const cmds: AgentCommand[] = [];
    for (const l of linhas) {
      // Entrega única: dois polls simultâneos (instâncias diferentes) não
      // entregam o mesmo comando duas vezes.
      const r = await db.agente_Comandos.updateMany({
        where: { id: l.id, status: 'pendente' },
        data: { status: 'entregue' },
      });
      if (Number(r?.count ?? 0) !== 1) continue;
      try {
        cmds.push(JSON.parse(l.comando) as AgentCommand);
      } catch {
        this.logger.warn(`Comando ${l.id} com JSON inválido — descartado`);
      }
    }
    return cmds;
  }

  /** Chamado pelo agente para reportar o resultado de um comando. */
  async submitResult(commandId: string, result: AgentResult): Promise<void> {
    // Mesma instância que enfileirou: entrega direto, sem esperar a conferência.
    if (this.pending.has(commandId)) {
      this.finalizar(commandId, result);
      await this.db?.agente_Comandos.deleteMany({ where: { id: commandId } }).catch(() => undefined);
      return;
    }
    const db = this.db;
    if (!db) return; // já expirou ou desconhecido — ignora
    try {
      await db.agente_Comandos.updateMany({
        where: { id: commandId, status: { in: ['pendente', 'entregue'] } },
        data: { status: 'concluido', resultado: JSON.stringify(result ?? {}) },
      });
    } catch (err: any) {
      if (!this.tabelaAusente(err)) throw err;
    }
  }

  private finalizar(id: string, result: AgentResult) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(result);
  }

  /** Busca no banco os resultados dos comandos que ESTA instância espera. */
  private async conferirResultados() {
    const db = this.db;
    if (!db || this.pending.size === 0 || this.conferindoResultados) return;
    this.conferindoResultados = true;
    try {
      const ids = [...this.pending.keys()];
      const prontos: Array<{ id: string; resultado: string | null }> = await db.agente_Comandos.findMany({
        where: { id: { in: ids }, status: 'concluido' },
        select: { id: true, resultado: true },
      });
      for (const l of prontos) {
        let r: AgentResult = { ok: false, error: 'Resultado ilegível do agente.' };
        try {
          r = JSON.parse(l.resultado ?? '{}');
        } catch {
          /* mantém o erro */
        }
        this.finalizar(l.id, r);
      }
      if (prontos.length) {
        await db.agente_Comandos.deleteMany({ where: { id: { in: prontos.map((l) => l.id) } } });
      }
    } catch (err: any) {
      if (!this.tabelaAusente(err)) this.logger.warn(`Conferência de resultados do agente falhou: ${err?.message ?? err}`);
    } finally {
      this.conferindoResultados = false;
    }
  }

  /** Traz do banco o último poll e o status do aparelho vistos por QUALQUER instância. */
  private async atualizarCache() {
    const db = this.db;
    if (!db) return;
    try {
      const linhas: any[] = await db.agente_Dispositivos_Estado.findMany();
      for (const l of linhas) {
        const poll = l.ultimo_poll_em ? new Date(l.ultimo_poll_em).getTime() : null;
        if (poll !== null && poll > (this.lastSeen.get(l.id_device) ?? 0)) this.lastSeen.set(l.id_device, poll);
        const statusEm = l.aparelho_status_em ? new Date(l.aparelho_status_em).getTime() : null;
        if (statusEm !== null && l.aparelho_online !== null && statusEm > (this.deviceStatus.get(l.id_device)?.at ?? 0)) {
          this.deviceStatus.set(l.id_device, { online: l.aparelho_online === 1, at: statusEm });
        }
      }
    } catch (err: any) {
      if (!this.tabelaAusente(err)) this.logger.warn(`Atualização do cache do agente falhou: ${err?.message ?? err}`);
    }
  }

  /** Apaga comandos vencidos (entregues sem resultado, ou de instância que morreu). */
  private async faxina() {
    const db = this.db;
    if (!db) return;
    try {
      await db.agente_Comandos.deleteMany({ where: { expira_em: { lt: new Date(Date.now() - 5 * 60 * 1000) } } });
    } catch (err: any) {
      if (!this.tabelaAusente(err)) this.logger.warn(`Faxina de agente_comandos falhou: ${err?.message ?? err}`);
    }
  }

  /**
   * Chamado pelo agente (POST condo/:token/telemetria, ~1x/min) para
   * atualizar o retrato de saúde do condomínio: versão, SO, saúde por
   * device e fila offline pendente. Guardado em estado_compartilhado (TTL
   * 24h) — o portal lê em qualquer instância.
   *
   * `payload` é `unknown` de propósito: a rota é `@Public()` (autenticada só
   * pelo token do device, sem JWT) e `@SkipThrottle()`, sob o limite global de
   * body (2 MB, common/limite-corpo.ts) — `AgentTelemetriaPayload` é só um tipo do TypeScript, apagado
   * em tempo de execução, então sem `sanitizarTelemetria()` um payload
   * malicioso ou de um agente com bug seria guardado do jeito que chegou
   * (string gigante, array enorme, campos a mais). Sanitiza SEMPRE, aqui
   * dentro — não depende do chamador lembrar de sanitizar antes de chamar.
   */
  async setTelemetria(idCondominio: number, payload: unknown): Promise<void> {
    const telemetria: AgentTelemetria = {
      recebido_em: new Date().toISOString(),
      ...sanitizarTelemetria(payload),
    };
    await this.estado.definir(`agente:telemetria:${idCondominio}`, telemetria, TELEMETRIA_TTL_MS);
  }

  /** Última telemetria do condomínio, ou null se o agente nunca reportou. */
  async getTelemetria(idCondominio: number): Promise<AgentTelemetria | null> {
    const e = await this.estado.obter<AgentTelemetria>(`agente:telemetria:${idCondominio}`);
    return e?.valor ?? null;
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
