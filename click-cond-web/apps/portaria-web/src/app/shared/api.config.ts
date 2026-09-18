export const API_BASE = '/api';

/**
 * Origem do Socket.IO.
 * Em produção, conecta diretamente na API da AWS (CloudFront / Elastic Beanstalk),
 * contornando o CDN estático do frontend (AWS Amplify) que não faz upgrade de WebSocket.
 * Em desenvolvimento local, conecta na porta 3000.
 */
export const REALTIME_ORIGIN = (() => {
  if (typeof window === 'undefined') return '';
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocal ? 'http://localhost:3000' : 'https://api.clickprestarecondominios.com.br';
})();

