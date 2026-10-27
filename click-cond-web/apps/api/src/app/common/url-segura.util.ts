import * as dns from 'dns';
import { lookup } from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import { isIP } from 'net';

/**
 * Proteção contra SSRF para URLs que o servidor baixa a pedido de um usuário
 * (foto_pessoa, link_doc...). Bloqueia esquemas que não sejam http(s), IPs
 * privados/loopback/link-local (inclui o metadata da AWS, 169.254.169.254) e
 * hosts que RESOLVEM para esses endereços. Quem chama deve também desligar
 * redirecionamentos (um 302 para o IP interno contornaria esta checagem) e
 * usar agentesSemRedeInterna() — sem ele o cliente HTTP resolve o nome de
 * novo e um DNS com TTL 0 troca a resposta para um IP interno (rebinding).
 */

/** Os 8 grupos de 16 bits de um IPv6 (aceita "::", sufixo IPv4 e zona %eth0); null se inválido. */
function gruposIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const sufixoV4 = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (sufixoV4) {
    const o = sufixoV4.slice(2).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${sufixoV4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const partes = s.split('::');
  if (partes.length > 2) return null;
  const esq = partes[0] ? partes[0].split(':') : [];
  const dir = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const zeros = partes.length === 2 ? 8 - esq.length - dir.length : 0;
  if (zeros < 0) return null;
  const grupos = [...esq, ...Array(zeros).fill('0'), ...dir];
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return grupos.map((g) => parseInt(g, 16));
}

function ipv4DosGrupos(alto: number, baixo: number): string {
  return `${alto >> 8}.${alto & 255}.${baixo >> 8}.${baixo & 255}`;
}

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
    const g = gruposIpv6(ip);
    if (!g) return true;
    const zerosAte = (n: number) => g.slice(0, n).every((x) => x === 0);
    // IPv4 embutido — o WHATWG URL serializa tudo em hex (::ffff:a9fe:a9fe):
    // mapeado (::ffff:0:0/96), SIIT (::ffff:0:0:0/96), compatível (::/96,
    // inclui :: e ::1) e NAT64 (64:ff9b::/96).
    if (
      (zerosAte(5) && g[5] === 0xffff) ||
      (zerosAte(4) && g[4] === 0xffff && g[5] === 0) ||
      zerosAte(6) ||
      (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    ) {
      return ipEhPrivado(ipv4DosGrupos(g[6], g[7]));
    }
    if (g[0] === 0x2002) return ipEhPrivado(ipv4DosGrupos(g[1], g[2])); // 6to4
    return (
      (g[0] & 0xfe00) === 0xfc00 || // fc00::/7 (ULA; inclui fd00:ec2::254 da AWS)
      (g[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
      (g[0] & 0xffc0) === 0xfec0 || // fec0::/10 site-local
      (g[0] & 0xff00) === 0xff00 // multicast
    );
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

/**
 * `lookup` para net/http: resolve o nome e RECUSA se qualquer endereço for
 * interno. Passado no http(s).Agent, o endereço checado é o mesmo que a
 * conexão usa (fecha o DNS rebinding entre urlExternaSegura e o download).
 */
export function lookupSeguro(hostname: string, options: any, callback?: any): void {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opcoes: dns.LookupAllOptions = { ...(options || {}), all: true };
  dns.lookup(hostname, opcoes, (err, lista) => {
    if (err) return callback(err);
    if (!lista.length || lista.some((e) => ipEhPrivado(e.address))) {
      const bloqueio: NodeJS.ErrnoException = new Error(`Host ${hostname} resolve para endereço interno`);
      bloqueio.code = 'EHOSTBLOQUEADO';
      return callback(bloqueio);
    }
    if (options && options.all) return callback(null, lista);
    return callback(null, lista[0].address, lista[0].family);
  });
}

/** Agentes para axios (`{ ...agentesSemRedeInterna() }`) que conectam só em IP público. */
export function agentesSemRedeInterna(): { httpAgent: http.Agent; httpsAgent: https.Agent; proxy: false } {
  return {
    // sem proxy do ambiente: com proxy o lookup resolveria o proxy, não o destino
    proxy: false as const,
    httpAgent: new http.Agent({ lookup: lookupSeguro as any }),
    httpsAgent: new https.Agent({ lookup: lookupSeguro as any }),
  };
}
