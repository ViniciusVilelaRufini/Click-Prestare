import { Logger } from '@nestjs/common';
import { createShardedAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { ClientePresenca } from './presenca-redis';

const logger = new Logger('RedisAdapter');

/** Tempo máximo para a conexão inicial com o Redis antes de cair para a memória. */
const CONEXAO_TIMEOUT_MS = 5_000;

/**
 * Adaptador do Socket.IO e o cliente da presença por sala. Este é uma conexão própria, com `disableOfflineQueue`:
 * com o Redis fora os comandos de presença rejeitam na hora (nada se acumula na memória), e nunca ficam na fila
 * do SPUBLISH do adaptador (nem à frente dele).
 */
export interface RedisTempoReal {
  adaptador: ReturnType<typeof createShardedAdapter>;
  redis: ClientePresenca;
}

/**
 * Adaptador Redis do Socket.IO, só quando REDIS_URL existe (aceita redis:// e rediss://).
 * Sem URL, ou se a conexão falhar, devolve null e o gateway segue com salas em memória (uma réplica).
 *
 * É o adaptador sharded (SSUBSCRIBE/SPUBLISH, canal por sala em modo dynamic): o ElastiCache Serverless recusa
 * PSUBSCRIBE (`ERR unknown command 'psubscribe'`), que o createAdapter clássico exige. O fetchSockets entre
 * réplicas não funciona lá (PUBSUB SHARDNUMSUB sempre 0): "há alguém na sala?" sai da presença (presenca-redis.ts).
 */
export async function criarAdaptadorRedis(
  url: string | undefined,
  timeoutMs = CONEXAO_TIMEOUT_MS,
): Promise<RedisTempoReal | null> {
  if (!url) return null;
  const clientes: Array<{ destroy?: () => void; disconnect?: () => unknown }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pub = createClient({ url });
    clientes.push(pub);
    const sub = pub.duplicate();
    clientes.push(sub);
    const presenca = pub.duplicate({ disableOfflineQueue: true });
    clientes.push(presenca);
    pub.on?.('error', (err: any) => logger.warn(`Redis pub: ${err?.message ?? err}`));
    sub.on?.('error', (err: any) => logger.warn(`Redis sub: ${err?.message ?? err}`));
    presenca.on?.('error', (err: any) => logger.warn(`Redis presença: ${err?.message ?? err}`));
    // O connect() do node-redis não rejeita com o servidor fora: ele fica tentando para sempre.
    const limite = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`sem conexão em ${timeoutMs} ms`)), timeoutMs);
      timer.unref?.();
    });
    await Promise.race([Promise.all([pub.connect(), sub.connect(), presenca.connect()]), limite]);
    const adaptador = createShardedAdapter(pub, sub, { subscriptionMode: 'dynamic' });
    return { adaptador, redis: presenca };
  } catch (err: any) {
    logger.error(`Redis indisponível, tempo real em memória: ${err?.message ?? err}`);
    for (const c of clientes) {
      try {
        if (c.destroy) c.destroy();
        else void c.disconnect?.();
      } catch {
        /* já fechado */
      }
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
