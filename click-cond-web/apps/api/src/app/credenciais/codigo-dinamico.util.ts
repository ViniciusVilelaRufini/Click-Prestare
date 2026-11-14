import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Formato do código dinâmico de acesso (QR que muda a cada 30 s).
 *
 * Código = prefixo ('P1') + base32(corpo | mac), 28 caracteres:
 *   corpo = id da credencial (uint32 BE) | contador (uint32 BE)
 *   mac   = primeiros 8 bytes de HMAC-SHA256(segredo, prefixo ASCII | corpo)
 *   contador = floor(unix_ms / 30000)
 *
 * O mesmo cálculo existe em Dart no app (lib/utils/codigo_dinamico.dart), com
 * os mesmos vetores de teste. Não mudar sem mudar os dois lados.
 *
 * O código lido nunca vai para log nem para Acessos_Facial: use
 * `rotuloDeCredencial` (cred:<id>).
 */

export type PrefixoCodigo = 'P1' | 'P2';

export const INTERVALO_MS = 30_000;

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PADRAO = /^P[12][A-Z2-7]{26}$/;
const BYTES_CORPO = 8;
const BYTES_MAC = 8;

export interface CodigoDecodificado {
  prefixo: PrefixoCodigo;
  id: number;
  contador: number;
  mac: Buffer;
}

function base32(bytes: Buffer): string {
  let saida = '';
  let acumulado = 0;
  let bits = 0;
  for (const b of bytes) {
    acumulado = ((acumulado << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(acumulado >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    saida += ALFABETO[(acumulado << (5 - bits)) & 31];
  }
  return saida;
}

function deBase32(texto: string, tamanho: number): Buffer | null {
  const saida = Buffer.alloc(tamanho);
  let acumulado = 0;
  let bits = 0;
  let pos = 0;
  for (const c of texto) {
    const v = ALFABETO.indexOf(c);
    if (v < 0) return null;
    acumulado = ((acumulado << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      if (pos >= tamanho) return null;
      saida[pos++] = (acumulado >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  if (pos !== tamanho) return null;
  return saida;
}

function calcularMac(prefixo: PrefixoCodigo, corpo: Buffer, segredo: Buffer): Buffer {
  return createHmac('sha256', segredo)
    .update(Buffer.concat([Buffer.from(prefixo, 'ascii'), corpo]))
    .digest()
    .subarray(0, BYTES_MAC);
}

function montarCorpo(id: number, contador: number): Buffer {
  const corpo = Buffer.alloc(BYTES_CORPO);
  corpo.writeUInt32BE(id >>> 0, 0);
  corpo.writeUInt32BE(contador >>> 0, 4);
  return corpo;
}

export function gerarCodigo(prefixo: PrefixoCodigo, id: number, contador: number, segredo: Buffer): string {
  const corpo = montarCorpo(id, contador);
  const mac = calcularMac(prefixo, corpo, segredo);
  return prefixo + base32(Buffer.concat([corpo, mac]));
}

/** Leitores USB/serial entregam com espaço, quebra de linha e às vezes em minúsculas. */
export function normalizarLeitura(valor: string | null | undefined): string {
  if (valor == null) return '';
  return String(valor).replace(/\s+/g, '').toUpperCase();
}

export function ehCodigoDinamico(valor: string | null | undefined): boolean {
  return PADRAO.test(normalizarLeitura(valor));
}

export function decodificarCodigo(valor: string): CodigoDecodificado | null {
  const limpo = normalizarLeitura(valor);
  if (!PADRAO.test(limpo)) return null;
  const bytes = deBase32(limpo.slice(2), BYTES_CORPO + BYTES_MAC);
  if (!bytes) return null;
  return {
    prefixo: limpo.slice(0, 2) as PrefixoCodigo,
    id: bytes.readUInt32BE(0),
    contador: bytes.readUInt32BE(4),
    mac: Buffer.from(bytes.subarray(BYTES_CORPO)),
  };
}

export function conferirMac(dec: CodigoDecodificado, segredo: Buffer): boolean {
  if (!dec || !Buffer.isBuffer(dec.mac) || dec.mac.length !== BYTES_MAC) return false;
  const esperado = calcularMac(dec.prefixo, montarCorpo(dec.id, dec.contador), segredo);
  return timingSafeEqual(esperado, dec.mac);
}

export function contadorDe(instante: Date): number {
  return Math.floor(instante.getTime() / INTERVALO_MS);
}

/**
 * Rótulo seguro para log e para Acessos_Facial.face_id: `cred:<id>` quando o
 * valor é um código dinâmico decodificável, `cred:?` quando parece um (começa
 * com P1/P2) mas não decodifica, e o próprio valor nos demais casos (PIN, tag).
 */
export function rotuloDeCredencial(valor: string | null | undefined): string {
  if (valor == null) return '';
  const dec = decodificarCodigo(valor);
  if (dec) return `cred:${dec.id}`;
  if (/^P[12]/.test(normalizarLeitura(valor))) return 'cred:?';
  return valor;
}
