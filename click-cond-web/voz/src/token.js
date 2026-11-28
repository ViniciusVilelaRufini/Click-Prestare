// Token de voz: JWT HS256 assinado pela API (VOZ_TOKEN_SECRET), validade 120 s,
// claims { cid, papel, uid, nome }. Mesmo formato de API/interfone/token-voz.ts
// (Task A2): qualquer HS256 padrão com essas claims é aceito.
import jwt from 'jsonwebtoken';

export const VALIDADE_TOKEN_S = 120;
/**
 * Diferença de relógio aceita entre o EB (que assina) e a EC2 (que confere),
 * nos dois sentidos: exp vale até +60 s e iat/exp podem estar 60 s "no futuro".
 * O token emitido continua valendo 120 s.
 */
export const TOLERANCIA_RELOGIO_S = 60;
const PAPEIS = new Set(['morador', 'portaria', 'origem', 'central']);

const agora = () => Math.floor(Date.now() / 1000);

export function assinarTokenVoz(c, segredo, agoraSeg = agora()) {
  if (!segredo) throw new Error('VOZ_TOKEN_SECRET ausente');
  return jwt.sign(
    { cid: c.cid, papel: c.papel, uid: c.uid, nome: c.nome, iat: agoraSeg, exp: agoraSeg + VALIDADE_TOKEN_S },
    segredo,
    { algorithm: 'HS256' },
  );
}

export function verificarTokenVoz(t, segredo, agoraSeg = agora()) {
  if (!t || typeof t !== 'string' || !segredo || t.length > 2048) return null;
  let p;
  try {
    p = jwt.verify(t, segredo, { algorithms: ['HS256'], clockTimestamp: agoraSeg, clockTolerance: TOLERANCIA_RELOGIO_S });
  } catch {
    return null;
  }
  if (!p || typeof p !== 'object') return null;
  if (!Number.isInteger(p.cid) || p.cid <= 0) return null;
  if (!PAPEIS.has(p.papel)) return null;
  if (!Number.isInteger(p.uid)) return null;
  if (typeof p.nome !== 'string') return null;
  // Sem exp o token não vence: recusa (a API sempre põe exp).
  if (!Number.isInteger(p.exp) || p.exp - agoraSeg > VALIDADE_TOKEN_S + TOLERANCIA_RELOGIO_S) return null;
  // Emitido "no futuro" além da tolerância: relógio muito fora, ou token forjado com o segredo.
  if (p.iat !== undefined && (!Number.isInteger(p.iat) || p.iat - agoraSeg > TOLERANCIA_RELOGIO_S)) return null;
  return { cid: p.cid, papel: p.papel, uid: p.uid, nome: p.nome };
}
