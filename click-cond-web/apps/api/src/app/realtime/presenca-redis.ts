import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/** Validade de um anúncio de presença: sem renovação nesse prazo, a réplica deixa de contar na sala. */
export const PRESENCA_TTL_MS = 15_000;

/** De quanto em quanto tempo a réplica reanuncia as salas em que tem sockets (bem abaixo do TTL). */
export const RENOVAR_PRESENCA_MS = 5_000;

/**
 * Teto de cada comando de presença. Com o Redis fora, a chamada nova do facial não pode esperar mais que isso
 * para decidir para onde ir (era o requestsTimeout do fetchSockets do adaptador clássico).
 */
export const CONSULTA_PRESENCA_MS = 2_000;

/** Identidade desta réplica nos ZSETs de presença: uma por processo. */
export const ID_REPLICA = randomUUID();

/** Chave do ZSET da sala: { membro: idReplica, score: expira em (ms epoch) }. */
export const chavePresenca = (sala: string) => `rt:presenca:${sala}`;

/**
 * O pedaço do cliente node-redis (v6) usado aqui — só comandos de uma chave, que o ElastiCache Serverless aceita
 * (nada de SCAN/KEYS/PSUBSCRIBE nem multi-key entre slots). É um cliente só da presença, criado com
 * `disableOfflineQueue`: fora do ar ele rejeita na hora em vez de enfileirar (ver criarAdaptadorRedis).
 */
export interface ClientePresenca {
  /** Conectado e pronto; false durante a reconexão (aí nada é enviado). */
  readonly isReady: boolean;
  zAdd(chave: string, membro: { value: string; score: number }): Promise<unknown>;
  zRem(chave: string, membro: string): Promise<unknown>;
  zRangeByScore(chave: string, min: number | string, max: number | string): Promise<ReadonlyArray<unknown>>;
  pExpire(chave: string, ms: number): Promise<unknown>;
  destroy?(): void;
}

/** Corre a promessa com teto; estourou, devolve o reserva (o comando atrasado segue sozinho e é ignorado). */
async function comTeto<T>(p: Promise<T>, ms: number, reserva: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const teto = new Promise<T>((r) => {
    timer = setTimeout(() => r(reserva), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([p, teto]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Presença por sala entre réplicas, para o ElastiCache Serverless: lá o adaptador sharded entrega os emits entre
 * servidores, mas o fetchSockets remoto volta 0 (o PUBSUB SHARDNUMSUB sempre responde 0 e o adaptador acha que
 * está sozinho). Cada réplica anuncia, por sala vigiada, "tenho gente aqui até T"; a outra só lê esse ZSET.
 * Nunca lança: Redis com erro, lento ou fora do ar vale como "ninguém em outra réplica".
 */
export class PresencaRedis {
  private logger: Pick<Logger, 'warn' | 'log'> = new Logger('PresencaRedis');
  readonly idReplica: string;
  private readonly agora: () => number;
  private readonly tetoMs: number;
  /** Último estado visto do Redis: os logs saem só na transição (caiu/voltou), não por sala a cada rodada. */
  private disponivel = true;

  constructor(
    private readonly redis: ClientePresenca,
    opcoes: { idReplica?: string; agora?: () => number; tetoMs?: number } = {},
  ) {
    this.idReplica = opcoes.idReplica ?? ID_REPLICA;
    this.agora = opcoes.agora ?? Date.now;
    this.tetoMs = opcoes.tetoMs ?? CONSULTA_PRESENCA_MS;
  }

  private caiu(motivo: string): void {
    if (!this.disponivel) return;
    this.disponivel = false;
    this.logger.warn(`Redis indisponível para a presença (${motivo}); só os sockets locais contam até ele voltar.`);
  }

  private voltou(): void {
    if (this.disponivel) return;
    this.disponivel = true;
    this.logger.log('Redis da presença de volta.');
  }

  /** Executa o comando com teto. Fora do ar, nem envia. Devolve o resultado ou null (falhou/estourou). */
  private async executar<T>(comando: () => Promise<T>): Promise<T | null> {
    if (!this.redis.isReady) {
      this.caiu('cliente desconectado');
      return null;
    }
    try {
      const r = await comTeto<{ v: T } | null>(
        comando().then((v) => ({ v })),
        this.tetoMs,
        null,
      );
      if (r === null) {
        this.caiu(`sem resposta em ${this.tetoMs} ms`);
        return null;
      }
      this.voltou();
      return r.v;
    } catch (err: any) {
      this.caiu(err?.message ?? String(err));
      return null;
    }
  }

  /** Ativo: ZADD (agora+TTL) + PEXPIRE 2×TTL (a chave some sozinha se todas as réplicas morrerem). Inativo: ZREM. */
  async anunciar(sala: string, ativo: boolean): Promise<void> {
    const chave = chavePresenca(sala);
    await this.executar(async () => {
      if (ativo) {
        await this.redis.zAdd(chave, { value: this.idReplica, score: this.agora() + PRESENCA_TTL_MS });
        await this.redis.pExpire(chave, 2 * PRESENCA_TTL_MS);
      } else {
        await this.redis.zRem(chave, this.idReplica);
      }
    });
  }

  /** Alguma OUTRA réplica tem anúncio válido nesta sala? Teto de 2 s; erro, demora ou fora do ar → false. */
  async outrasReplicasNaSala(sala: string): Promise<boolean> {
    const membros = await this.executar(() => this.redis.zRangeByScore(chavePresenca(sala), this.agora(), '+inf'));
    return (membros ?? []).some((m) => String(m) !== this.idReplica);
  }

  /** Destroy do módulo: retira (best-effort, em paralelo, com teto) os anúncios desta réplica e fecha o cliente. */
  async encerrar(salas: Iterable<string>): Promise<void> {
    await Promise.allSettled([...salas].map((sala) => this.anunciar(sala, false)));
    try {
      this.redis.destroy?.();
    } catch {
      /* já fechado */
    }
  }
}
