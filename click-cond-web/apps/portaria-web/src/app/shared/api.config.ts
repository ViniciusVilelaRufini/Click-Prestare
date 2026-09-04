export const API_BASE = '/api';

/** Origem da API no Railway — só usada pelo Socket.IO (ver REALTIME_ORIGIN). */
const RAILWAY_ORIGIN = 'https://click-prestare-production.up.railway.app';

/**
 * Origem do Socket.IO. O HTTP comum continua relativo (`/api`), passando pelo
 * rewrite da Vercel; o socket NÃO pode passar por ele, por dois motivos:
 *
 * 1. `/api/:path*` no vercel.json não casa com `/api/socket.io/` — a barra
 *    final, que o socket.io sempre usa no handshake. A requisição cai no
 *    catch-all do SPA e volta `index.html` em vez do handshake.
 * 2. Mesmo casando, rewrite da Vercel para destino externo não faz upgrade de
 *    WebSocket: o mesmo request que devolve 101 no Railway devolve 200 aqui.
 *
 * Então em produção o socket fala direto com o Railway. O gateway aceita a
 * origem (`cors: { origin: true }`) e valida o mesmo JWT do HTTP. Em dev fica
 * na mesma origem, onde o proxy do Angular resolve.
 */
export const REALTIME_ORIGIN = (() => {
  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  return local ? window.location.origin : RAILWAY_ORIGIN;
})();
