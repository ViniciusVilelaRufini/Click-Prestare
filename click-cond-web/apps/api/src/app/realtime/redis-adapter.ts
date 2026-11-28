import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const logger = new Logger('RedisAdapter');

/**
 * Adaptador Redis do Socket.IO, só quando REDIS_URL existe (aceita redis:// e rediss://).
 * Sem URL, ou se a conexão falhar, devolve null e o gateway segue com salas em memória (uma réplica).
 */
export async function criarAdaptadorRedis(url: string | undefined): Promise<ReturnType<typeof createAdapter> | null> {
  if (!url) return null;
  try {
    const pub = createClient({ url });
    const sub = pub.duplicate();
    pub.on?.('error', (err: any) => logger.warn(`Redis pub: ${err?.message ?? err}`));
    sub.on?.('error', (err: any) => logger.warn(`Redis sub: ${err?.message ?? err}`));
    await Promise.all([pub.connect(), sub.connect()]);
    return createAdapter(pub, sub);
  } catch (err: any) {
    logger.error(`Redis indisponível, tempo real em memória: ${err?.message ?? err}`);
    return null;
  }
}
