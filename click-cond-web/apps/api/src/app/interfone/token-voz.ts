import * as crypto from 'crypto';

/**
 * Token curto de entrada na central de voz e credencial TURN.
 *
 * O app e o console não ficam registrados na central: ao atender ou ligar,
 * pedem à API um token (JWT HS256, 120 s) e discam sip:entrar@... com o
 * cabeçalho X-Prestare-Token. O serviço de voz verifica com o mesmo segredo
 * (VOZ_TOKEN_SECRET) usando jsonwebtoken — por isso o formato é JWT padrão.
 * Implementado com `crypto` para não puxar dependência nova na API.
 */

export const VOZ_HOST = 'voz.prestarecondominios.com.br';
export const VOZ_WSS = `wss://${VOZ_HOST}:8089/ws`;
export const VOZ_SIP_URI = `sip:entrar@${VOZ_HOST}` as const;
export const TOKEN_VOZ_VALIDADE_S = 120;
export const TURN_VALIDADE_S = 3600;

export type PapelVoz = 'morador' | 'portaria' | 'origem' | 'central';

export interface ClaimsVoz {
  cid: number;
  papel: PapelVoz;
  uid: number;
  nome: string;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Resposta de todo "atender"/"ligar" (Contrato da API). */
export interface DadosEntrada {
  id: number;
  token: string;
  wss: string;
  sip_uri: typeof VOZ_SIP_URI;
  ice: IceServer[];
}

const PAPEIS: ReadonlySet<string> = new Set(['morador', 'portaria', 'origem', 'central']);

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const agoraS = () => Math.floor(Date.now() / 1000);

function assinar(dados: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(dados).digest('base64url');
}

export function assinarTokenVoz(c: ClaimsVoz, segredo: string, agoraSeg: number = agoraS()): string {
  if (!segredo) throw new Error('VOZ_TOKEN_SECRET ausente');
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url({ cid: c.cid, papel: c.papel, uid: c.uid, nome: c.nome, iat: agoraSeg, exp: agoraSeg + TOKEN_VOZ_VALIDADE_S });
  return `${h}.${p}.${assinar(`${h}.${p}`, segredo)}`;
}

/** Claims do token, ou null se inválido, adulterado, de outro segredo ou expirado. Nunca lança. */
export function verificarTokenVoz(t: string, segredo: string, agoraSeg: number = agoraS()): ClaimsVoz | null {
  try {
    if (!segredo || typeof t !== 'string') return null;
    const partes = t.split('.');
    if (partes.length !== 3) return null;
    const [h, p, s] = partes;
    const cab = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (!cab || cab.alg !== 'HS256') return null;
    const esperado = Buffer.from(assinar(`${h}.${p}`, segredo));
    const recebido = Buffer.from(s);
    if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
    const c = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!c || typeof c.exp !== 'number' || agoraSeg >= c.exp) return null;
    if (!Number.isInteger(c.cid) || !Number.isInteger(c.uid) || typeof c.nome !== 'string' || !PAPEIS.has(c.papel)) {
      return null;
    }
    return { cid: c.cid, papel: c.papel, uid: c.uid, nome: c.nome };
  } catch {
    return null;
  }
}

/**
 * Credencial TURN no formato "TURN REST" do coturn (use-auth-secret):
 * username = "<exp>:<uid>", credential = base64(HMAC-SHA1(segredo, username)).
 */
export function credencialTurn(uid: number, segredo: string, agoraSeg: number = agoraS()): { username: string; credential: string } {
  const username = `${agoraSeg + TURN_VALIDADE_S}:${uid}`;
  const credential = crypto.createHmac('sha1', segredo).update(username).digest('base64');
  return { username, credential };
}

export function montarDadosEntrada(id: number, token: string, turn: { username: string; credential: string }): DadosEntrada {
  return {
    id,
    token,
    wss: VOZ_WSS,
    sip_uri: VOZ_SIP_URI,
    ice: [
      { urls: [`stun:${VOZ_HOST}:3478`] },
      {
        urls: [`turn:${VOZ_HOST}:3478?transport=udp`, `turn:${VOZ_HOST}:3478?transport=tcp`],
        username: turn.username,
        credential: turn.credential,
      },
    ],
  };
}
