import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const logger = new Logger('RedisAdapter');

/** Tempo máximo para a conexão inicial com o Redis antes de cair para a memória. */
const CONEXAO_TIMEOUT_MS = 5_000;

/**
 * Teto das consultas entre réplicas (fetchSockets de porteirosOnline/centralOnline). O padrão do adaptador
 * é 5 s: com o Redis fora, cada chamada nova do facial esperava isso antes de decidir para onde ir.
 */
export const REQUESTS_TIMEOUT_MS = 2_000;

/**
 * Adaptador Redis do Socket.IO, só quando REDIS_URL existe (aceita redis:// e rediss://).
 * Sem URL, ou se a conexão falhar, devolve null e o gateway segue com salas em memória (uma réplica).
 */
export async function criarAdaptadorRedis(
  url: string | undefined,
  timeoutMs = CONEXAO_TIMEOUT_MS,
): Promise<ReturnType<typeof createAdapter> | null> {
  if (!url) return null;
  const clientes: Array<{ destroy?: () => void; disconnect?: () => unknown }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pub = createClient({ url });
    clientes.push(pub);
    const sub = pub.duplicate();
    clientes.push(sub);
    pub.on?.('error', (err: any) => logger.warn(`Redis pub: ${err?.message ?? err}`));
    sub.on?.('error', (err: any) => logger.warn(`Redis sub: ${err?.message ?? err}`));
    // O connect() do node-redis não rejeita com o servidor fora: ele fica tentando para sempre.
    const limite = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error(`sem conexão em ${timeoutMs} ms`)), timeoutMs);
      timer.unref?.();
    });
    await Promise.race([Promise.all([pub.connect(), sub.connect()]), limite]);
    return createAdapter(pub, sub, { requestsTimeout: REQUESTS_TIMEOUT_MS });
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
