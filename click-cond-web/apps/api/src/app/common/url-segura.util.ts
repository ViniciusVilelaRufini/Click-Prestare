import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Proteção contra SSRF para URLs que o servidor baixa a pedido de um usuário
 * (foto_pessoa, link_doc...). Bloqueia esquemas que não sejam http(s), IPs
 * privados/loopback/link-local (inclui o metadata da AWS, 169.254.169.254) e
 * hosts que RESOLVEM para esses endereços. Quem chama deve também desligar
 * redirecionamentos (um 302 para o IP interno contornaria esta checagem).
 */

export function ipEhPrivado(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local + metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast/reservado
    );
  }
  if (v === 6) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    const mapeado = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeado) return ipEhPrivado(mapeado[1]);
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff');
  }
  return true; // não é IP válido: trate como inseguro
}

/** true se a URL é http(s) e todos os endereços do host são públicos. */
export async function urlExternaSegura(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;
  if (isIP(host)) return !ipEhPrivado(host);
  try {
    const enderecos = await lookup(host, { all: true });
    return enderecos.length > 0 && enderecos.every((e) => !ipEhPrivado(e.address));
  } catch {
    return false;
  }
}
