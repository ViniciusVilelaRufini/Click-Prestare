export const API_BASE = '/api';

/**
 * Origem do Socket.IO. O HTTP comum continua relativo (`/api`), passando pelo
 * rewrite da Vercel.
 */
export const REALTIME_ORIGIN = (() => {
  if (typeof window === 'undefined') return '';
  return window.location.origin;
})();

