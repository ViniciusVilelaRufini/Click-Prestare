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

// IPs conhecidos de proxies intermediários da infraestrutura (Railway/Vercel/AWS NAT)
const KNOWN_PROXY_IPS = new Set([
  '18.228.188.5',
]);

function isValidClientIp(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const norm = normalizeIp(ip);
  if (!norm) return false;
  if (KNOWN_PROXY_IPS.has(norm)) return false;
  return true;
}

export function extractClientIp(req: any): string {
  if (!req) return '';

  const headers = req.headers || {};

  // 1. Vercel: Quando a portaria-web é acessada via Vercel (rewrite vercel.json -> Railway),
  // a Vercel conecta no Railway a partir de seu IP de borda (ex: 18.228.188.5) e repassa
  // o IP REAL do usuário final no cabeçalho 'x-vercel-forwarded-for'.
  const xVercel = headers['x-vercel-forwarded-for'];
  if (xVercel) {
    const raw = Array.isArray(xVercel) ? xVercel[0] : xVercel;
    if (typeof raw === 'string' && raw.trim()) {
      const first = raw.split(',')[0].trim();
      if (isValidClientIp(first)) {
        return normalizeIp(first);
      }
    }
  }

  // 2. Cloudflare (CF-Connecting-IP traz sempre o IP real do cliente)
  const cfConnectingIp = headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && isValidClientIp(cfConnectingIp)) {
    return normalizeIp(cfConnectingIp);
  }

  // 3. Fastly / Akamai
  const fastlyClientIp = headers['fastly-client-ip'];
  if (typeof fastlyClientIp === 'string' && isValidClientIp(fastlyClientIp)) {
    return normalizeIp(fastlyClientIp);
  }

  // 4. X-Forwarded-For: Varre a lista de IPs e pega o primeiro IP que NÃO seja proxy de infraestrutura
  const xForwardedFor = headers['x-forwarded-for'];
  if (xForwardedFor) {
    const rawXff = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
    if (typeof rawXff === 'string' && rawXff.trim()) {
      const ips = rawXff.split(',').map((s: string) => s.trim()).filter(Boolean);
      const validIp = ips.find((ip: string) => isValidClientIp(ip));
      if (validIp) {
        return normalizeIp(validIp);
      }
      if (ips[0]) return normalizeIp(ips[0]);
    }
  }

  // 5. Express req.ip (quando trust proxy está habilitado)
  if (req.ip && typeof req.ip === 'string' && isValidClientIp(req.ip)) {
    return normalizeIp(req.ip);
  }

  // 6. Headers alternativos de proxy reverso / CDN
  const trueClientIp = headers['true-client-ip'];
  if (typeof trueClientIp === 'string' && isValidClientIp(trueClientIp)) {
    return normalizeIp(trueClientIp);
  }

  const xRealIp = headers['x-real-ip'];
  if (typeof xRealIp === 'string' && isValidClientIp(xRealIp)) {
    return normalizeIp(xRealIp);
  }

  const xClientIp = headers['x-client-ip'];
  if (typeof xClientIp === 'string' && isValidClientIp(xClientIp)) {
    return normalizeIp(xClientIp);
  }

  // 7. Fallback: req.ip ou socket remoto mesmo se for proxy
  const rawIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return normalizeIp(rawIp);
}
