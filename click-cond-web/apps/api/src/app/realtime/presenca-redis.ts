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
 * (nada de SCAN/KEYS/PSUBSCRIBE nem multi-key entre slots).
 */
export interface ClientePresenca {
  zAdd(chave: string, membro: { value: string; score: number }): Promise<unknown>;
  zRem(chave: string, membro: string): Promise<unknown>;
  zRangeByScore(chave: string, min: number | string, max: number | string): Promise<ReadonlyArray<unknown>>;
  pExpire(chave: string, ms: number): Promise<unknown>;
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
 * Nunca lança: Redis com erro ou lento vale como "ninguém em outra réplica".
 */
export class PresencaRedis {
  private logger = new Logger('PresencaRedis');
  readonly idReplica: string;
  private readonly agora: () => number;
  private readonly tetoMs: number;

  constructor(
    private readonly redis: ClientePresenca,
    opcoes: { idReplica?: string; agora?: () => number; tetoMs?: number } = {},
  ) {
    this.idReplica = opcoes.idReplica ?? ID_REPLICA;
    this.agora = opcoes.agora ?? Date.now;
    this.tetoMs = opcoes.tetoMs ?? CONSULTA_PRESENCA_MS;
  }

  /** Ativo: ZADD (agora+TTL) + PEXPIRE 2×TTL (a chave some sozinha se todas as réplicas morrerem). Inativo: ZREM. */
  async anunciar(sala: string, ativo: boolean): Promise<void> {
    const chave = chavePresenca(sala);
    const comando = async () => {
      if (ativo) {
        await this.redis.zAdd(chave, { value: this.idReplica, score: this.agora() + PRESENCA_TTL_MS });
        await this.redis.pExpire(chave, 2 * PRESENCA_TTL_MS);
      } else {
        await this.redis.zRem(chave, this.idReplica);
      }
      return true;
    };
    try {
      const ok = await comTeto(comando(), this.tetoMs, false);
      if (!ok) this.logger.warn(`Presença ${sala}: Redis sem resposta em ${this.tetoMs} ms`);
    } catch (err: any) {
      this.logger.warn(`Presença ${sala}: ${err?.message ?? err}`);
    }
  }

  /** Alguma OUTRA réplica tem anúncio válido nesta sala? Teto de 2 s; erro ou demora → false. */
  async outrasReplicasNaSala(sala: string): Promise<boolean> {
    try {
      const membros = await comTeto(
        this.redis.zRangeByScore(chavePresenca(sala), this.agora(), '+inf'),
        this.tetoMs,
        null,
      );
      if (membros === null) {
        this.logger.warn(`Presença ${sala}: consulta sem resposta em ${this.tetoMs} ms`);
        return false;
      }
      return membros.some((m) => String(m) !== this.idReplica);
    } catch (err: any) {
      this.logger.warn(`Presença ${sala}: ${err?.message ?? err}`);
      return false;
    }
  }
}
