import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';

/**
 * Endereço do terminal (ip/porta) cadastrado pelo síndico. O mesmo valor vira
 * `http://${ip}:${porta}/...` no agente local E, com o agente offline, na
 * própria API (FacialDeviceClientService.baseUrl) — sem validação, um "ip"
 * como `169.254.169.254/latest/meta-data/x#` fazia a API chamar o metadata da
 * AWS. Rede privada (10/8, 172.16/12, 192.168/16) continua aceita: é onde os
 * terminais moram.
 */
const ROTULO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function motivoIpDispositivoInvalido(ip: unknown): string | null {
  if (typeof ip !== 'string' || !ip) return 'Informe o IP do terminal.';
  if (ip === 'sim' || ip === 'simulador') return null;
  const versao = isIP(ip);
  if (versao === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 127) return 'IP de loopback não é um terminal.';
    if (a === 169 && b === 254) return 'IP link-local (169.254.x.x) não é aceito.';
    if (a >= 224) return 'IP multicast/reservado não é aceito.';
    return null;
  }
  if (versao === 6) return 'Use o IPv4 do terminal.';
  if (ip.length > 253) return 'Host do terminal longo demais.';
  const rotulos = ip.split('.');
  if (!rotulos.every((r) => ROTULO.test(r))) return 'IP/host do terminal com caracteres inválidos.';
  // Último rótulo numérico/hex: o parser de URL lê como IPv4 (2130706433, 0x7f000001, 127.1).
  if (/^(0x[0-9a-f]*|\d+)$/i.test(rotulos[rotulos.length - 1])) return 'IPv4 do terminal inválido.';
  const host = ip.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return 'Host interno não é aceito.';
  }
  return null;
}

export function validarIpDispositivo(ip: unknown): string {
  const motivo = motivoIpDispositivoInvalido(ip);
  if (motivo) throw new BadRequestException(motivo);
  return ip as string;
}

export function validarPortaDispositivo(porta: unknown): number {
  const n = Number(porta);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new BadRequestException('Porta do terminal deve ser um número de 1 a 65535.');
  }
  return n;
}
