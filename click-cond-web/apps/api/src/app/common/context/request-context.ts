import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  ip?: string;
  userAgent?: string;
  /**
   * Referência FRACA ao `req` do Express. O middleware de main.ts roda ANTES do passport, então
   * req.user ainda não existe quando o contexto nasce; guardar a referência (e não o user) faz quem
   * lê depois — ex.: AuditoriaService.registrar — enxergar o usuário que o JwtAuthGuard preencheu no
   * mesmo objeto. Fraca porque o contexto acompanha todo recurso assíncrono criado na requisição
   * (timers, filas, promessas longas): uma referência forte prenderia o corpo (até 35 MB) na memória
   * enquanto eles vivessem. Durante a requisição o Express segura o `req`, então `deref()` funciona.
   * Fora de requisição (job, tick, fila) o contexto não existe.
   */
  reqRef?: WeakRef<{ user?: any } & Record<string, any>>;
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();

/** Contexto que o middleware de main.ts abre para cada requisição (ip, user-agent, req fraco). */
export function contextoDaRequisicao(req: any): RequestContextData {
  return {
    ip: extractClientIp(req),
    userAgent: req?.headers?.['user-agent'],
    reqRef: req && typeof req === 'object' ? new WeakRef(req) : undefined,
  };
}

export function normalizeIp(ip?: string | null): string {
  if (!ip) return '';
  let cleaned = String(ip).trim();
  // Se vier múltiplos IPs no header (ex: "client, proxy1, proxy2"), pega o primeiro
  if (cleaned.includes(',')) {
    cleaned = cleaned.split(',')[0].trim();
  }
  // Remove prefixo IPv6 mapped IPv4 (ex: ::ffff:192.168.1.1 -> 192.168.1.1)
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.substring(7);
  }
  // Localhost IPv6 ::1 -> 127.0.0.1
  if (cleaned === '::1') {
    cleaned = '127.0.0.1';
  }
  return cleaned.substring(0, 45);
}

export function extractClientIp(req: any): string {
  if (!req) return '';

  // 1. Express req.ip: calculado confiavelmente pelo Express com base na configuração
  // de 'trust proxy' (3 saltos: nginx + ALB + CloudFront; ver main.ts).
  // O Express ignora cabeçalhos X-Forwarded-For forjados pelo cliente e extrai o IP real.
  if (req.ip && typeof req.ip === 'string') {
    const norm = normalizeIp(req.ip);
    if (norm) return norm;
  }

  // 2. Fallback de socket remoto para conexões diretas ou testes unitários sem Express
  const rawIp = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return normalizeIp(rawIp);
}
