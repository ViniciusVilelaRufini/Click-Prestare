export function isLocalHost(hostname?: string): boolean {
  if (typeof window === 'undefined' && !hostname) return true;
  const host = hostname ?? window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function shouldDirectToApi(hostname?: string): boolean {
  return !isLocalHost(hostname);
}

export const API_BASE = (() => {
  return isLocalHost() ? '/api' : 'https://api.clickprestarecondominios.com.br/api';
})();

/**
 * Origem do Socket.IO.
 * Em produção, conecta diretamente na API da AWS (CloudFront / Elastic Beanstalk),
 * contornando o CDN estático do frontend (AWS Amplify) que não faz upgrade de WebSocket.
 * Em desenvolvimento local, conecta na porta 3000.
 */
export const REALTIME_ORIGIN = (() => {
  return isLocalHost() ? 'http://localhost:3000' : 'https://api.clickprestarecondominios.com.br';
})();
