import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  ip?: string;
  userAgent?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();

export function normalizeIp(ip?: string | null): string {
  if (!ip) return '';
  let cleaned = String(ip).trim();
  // Se vier múltiplos IPs no header (ex: "client, proxy1, proxy2"), pega o primeiro (cliente original)
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

  const headers = req.headers || {};

  // 1. Cloudflare (quando presente, CF-Connecting-IP traz sempre o IP original do cliente)
  const cfConnectingIp = headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return normalizeIp(cfConnectingIp);
  }

  // 2. X-Forwarded-For (padrão absoluto em proxies como Railway, AWS ELB, Vercel, Heroku, etc.)
  // IMPORTANTE: Em ambientes como Railway/AWS, o primeiro IP da lista é SEMPRE o cliente real.
  // Os proxies da nuvem anexam seus próprios IPs no final da cadeia (ex: "177.21.50.24, 18.228.188.5").
  // Por isso o X-Forwarded-For DEVE ser verificado antes do X-Real-IP.
  const xForwardedFor = headers['x-forwarded-for'];
  if (xForwardedFor) {
    const rawXff = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
    if (typeof rawXff === 'string' && rawXff.trim()) {
      const firstIp = rawXff.split(',')[0].trim();
      if (firstIp) return normalizeIp(firstIp);
    }
  }

  // 3. Express req.ip (quando trust proxy está habilitado no Express, ele extrai o cliente de XFF)
  if (req.ip && typeof req.ip === 'string' && req.ip.trim()) {
    return normalizeIp(req.ip);
  }

  // 4. Headers alternativos de CDN / proxy reverso (fallback caso XFF não esteja presente)
  const trueClientIp = headers['true-client-ip'];
  if (typeof trueClientIp === 'string' && trueClientIp.trim()) {
    return normalizeIp(trueClientIp);
  }

  const xRealIp = headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return normalizeIp(xRealIp);
  }

  const xClientIp = headers['x-client-ip'];
  if (typeof xClientIp === 'string' && xClientIp.trim()) {
    return normalizeIp(xClientIp);
  }

  // 5. Socket remoteAddress
  const rawIp = req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return normalizeIp(rawIp);
}
