'use strict';

/**
 * Quem pode usar o preview ao vivo local (http://127.0.0.1:8788/liveview e
 * /snapshot). O servidor só escuta em 127.0.0.1, mas isso não basta:
 *  - qualquer site aberto no navegador da portaria fazia fetch('/snapshot')
 *    e LIA o quadro da câmera (o agente respondia ACAO "*");
 *  - uma página com DNS rebinding chega ao 127.0.0.1 com Host do atacante.
 * Regras: Host tem de ser 127.0.0.1:<porta> ou localhost:<porta>; Origin, se
 * vier (fetch), tem de ser do portaria-web — e o ACAO devolve essa origem,
 * nunca "*". <img> não manda Origin e continua funcionando.
 */

// Mesmas de CORS_ORIGINS_PRINCIPAIS da API (apps/api/src/app/common/cors-origins.ts)
// que servem o portaria-web. Outras: LIVEVIEW_ORIGINS no .env do agente.
const ORIGENS_PORTARIA = [
  'https://clickprestarecondominios.com.br',
  'https://www.clickprestarecondominios.com.br',
  'https://prestarecondominios.com.br',
  'https://www.prestarecondominios.com.br',
  'https://main.d340ziyanv9pav.amplifyapp.com',
  'http://localhost:4200',
];

function origensLiveView(env = process.env) {
  const extras = String((env && env.LIVEVIEW_ORIGINS) || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...ORIGENS_PORTARIA, ...extras])];
}

function avaliarAcessoLiveView(headers, porta, origens) {
  const host = String((headers && headers.host) || '').toLowerCase();
  if (host !== `127.0.0.1:${porta}` && host !== `localhost:${porta}`) {
    return { permitido: false, origem: null };
  }
  const origin = headers && headers.origin;
  if (origin === undefined) return { permitido: true, origem: null };
  if (!origens.includes(origin)) return { permitido: false, origem: null };
  return { permitido: true, origem: origin };
}

module.exports = { avaliarAcessoLiveView, origensLiveView, ORIGENS_PORTARIA };
