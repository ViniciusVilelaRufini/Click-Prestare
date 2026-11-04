import { Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Bulkhead: limita quantas chamadas simultâneas a API faz para UMA dependência
 * externa (Bedrock/Gemini, Superlógica, WhatsApp Cloud API, SMTP).
 *
 * Sem isso, uma dependência lenta (Bedrock demorando 60s, SMTP pendurado)
 * acumula requisições em voo até esgotar memória, sockets e conexões do banco
 * da instância — e derruba rotas que nada têm a ver com ela. Com o limite, a
 * dependência lenta só degrada a si mesma: quem passa do teto espera numa fila
 * curta e, se a fila estiver cheia ou a espera passar do prazo, falha NA HORA
 * com 503 e mensagem clara, em vez de pendurar.
 *
 * O limite é POR INSTÂNCIA (2 instâncias = até 2× o teto contra a dependência).
 * Os tetos escolhidos estão em LIMITES_EXTERNOS, abaixo.
 */

export interface OpcoesLimite {
  /** Quantos podem esperar na fila além dos `max` em voo (padrão: 2× max). */
  filaMaxima?: number;
  /** Quanto tempo alguém espera na fila antes de desistir (padrão: 30s). */
  esperaMaximaMs?: number;
}

/** Tetos por dependência — por instância. Ver docs no relatório da tarefa. */
export const LIMITES_EXTERNOS = {
  /** Bedrock (Claude/Titan) ou Gemini: chamadas longas (até ~60s), cota por conta. */
  ia: { max: 8, filaMaxima: 16, esperaMaximaMs: 30_000 },
  /** Superlógica: ERP de terceiro, sensível a rajada; sync roda em série. */
  superlogica: { max: 4, filaMaxima: 20, esperaMaximaMs: 60_000 },
  /** WhatsApp Cloud API (Graph): envios do CRM e mídia. */
  whatsapp: { max: 8, filaMaxima: 32, esperaMaximaMs: 30_000 },
  /** SMTP: poucas conexões simultâneas por conta no provedor. */
  smtp: { max: 4, filaMaxima: 40, esperaMaximaMs: 60_000 },
} as const;

export class ConcorrenciaEsgotadaError extends ServiceUnavailableException {
  constructor(nome: string, motivo: string) {
    super(`Serviço externo "${nome}" sobrecarregado (${motivo}). Tente novamente em instantes.`);
    this.name = 'ConcorrenciaEsgotadaError';
  }
}

interface Espera {
  liberar: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

class Semaforo {
  emVoo = 0;
  readonly fila: Espera[] = [];
  constructor(
    readonly nome: string,
    readonly max: number,
    readonly filaMaxima: number,
    readonly esperaMaximaMs: number,
  ) {}

  async executar<T>(fn: () => Promise<T>): Promise<T> {
    if (this.emVoo >= this.max) await this.entrarNaFila();
    else this.emVoo++;
    try {
      return await fn();
    } finally {
      this.soltar();
    }
  }

  private entrarNaFila(): Promise<void> {
    if (this.fila.length >= this.filaMaxima) {
      logger.warn(`Bulkhead "${this.nome}" cheio (${this.emVoo} em voo, ${this.fila.length} na fila) — recusando`);
      return Promise.reject(new ConcorrenciaEsgotadaError(this.nome, 'fila cheia'));
    }
    return new Promise<void>((resolve, reject) => {
      const espera: Espera = { liberar: resolve };
      espera.timer = setTimeout(() => {
        const i = this.fila.indexOf(espera);
        if (i >= 0) this.fila.splice(i, 1);
        reject(new ConcorrenciaEsgotadaError(this.nome, `espera passou de ${Math.round(this.esperaMaximaMs / 1000)}s`));
      }, this.esperaMaximaMs);
      espera.timer.unref?.();
      this.fila.push(espera);
    });
  }

  /** A vaga passa direto para o próximo da fila (emVoo não muda), ou é devolvida. */
  private soltar() {
    const proximo = this.fila.shift();
    if (proximo) {
      if (proximo.timer) clearTimeout(proximo.timer);
      proximo.liberar();
    } else {
      this.emVoo--;
    }
  }
}

const logger = new Logger('Bulkhead');
const semaforos = new Map<string, Semaforo>();

/**
 * Devolve o executor do bulkhead `nome`. O mesmo nome devolve sempre o mesmo
 * semáforo no processo (a configuração da PRIMEIRA chamada vale).
 *
 *   const limitarIa = limitarConcorrencia('ia', 8);
 *   await limitarIa(() => bedrock.send(cmd));
 */
export function limitarConcorrencia(
  nome: string,
  max: number,
  opcoes: OpcoesLimite = {},
): <T>(fn: () => Promise<T>) => Promise<T> {
  let s = semaforos.get(nome);
  if (!s) {
    s = new Semaforo(
      nome,
      Math.max(1, Math.floor(max)),
      Math.max(0, Math.floor(opcoes.filaMaxima ?? max * 2)),
      opcoes.esperaMaximaMs ?? 30_000,
    );
    semaforos.set(nome, s);
  }
  const semaforo = s;
  return <T>(fn: () => Promise<T>) => semaforo.executar(fn);
}

/** Retrato dos bulkheads (para diagnóstico/health). */
export function estadoDosLimites(): Record<string, { max: number; emVoo: number; naFila: number }> {
  const out: Record<string, { max: number; emVoo: number; naFila: number }> = {};
  for (const [nome, s] of semaforos) out[nome] = { max: s.max, emVoo: s.emVoo, naFila: s.fila.length };
  return out;
}

/** Atalho para as dependências conhecidas, com os tetos de LIMITES_EXTERNOS. */
export function limiteExterno(dep: keyof typeof LIMITES_EXTERNOS) {
  const cfg = LIMITES_EXTERNOS[dep];
  return limitarConcorrencia(dep, cfg.max, cfg);
}
