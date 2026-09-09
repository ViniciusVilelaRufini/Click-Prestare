import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  ip?: string;
  userAgent?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();

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

  const headers = req.headers || {};

  // 1. Cloudflare
  const cfConnectingIp = headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return normalizeIp(cfConnectingIp);
  }

  // 2. True-Client-IP / X-Real-IP (Nginx / CDN)
  const trueClientIp = headers['true-client-ip'];
  if (typeof trueClientIp === 'string' && trueClientIp.trim()) {
    return normalizeIp(trueClientIp);
  }

  const xRealIp = headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return normalizeIp(xRealIp);
  }

  // 3. X-Forwarded-For (padrão em proxies como Railway, AWS ELB, Vercel, etc.)
  const xForwardedFor = headers['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    const firstIp = xForwardedFor.split(',')[0].trim();
    if (firstIp) return normalizeIp(firstIp);
  }

  // 4. Header de cliente personalizado
  const xClientIp = headers['x-client-ip'];
  if (typeof xClientIp === 'string' && xClientIp.trim()) {
    return normalizeIp(xClientIp);
  }

  // 5. Express req.ip ou socket remoteAddress
  const rawIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return normalizeIp(rawIp);
}
