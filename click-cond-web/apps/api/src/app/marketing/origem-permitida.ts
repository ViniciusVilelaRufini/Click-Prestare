import { CORS_ORIGINS_PRINCIPAIS } from '../common/cors-origins';

/**
 * Abuso barato em POST /api/public/leads: navegadores sempre mandam Origin em
 * fetch cross-origin, então um Origin fora da lista principal é um chamador
 * que não é a nossa landing (script/curl direto). Requisições sem Origin
 * (chamadas de servidor a servidor, scripts) são permitidas.
 */
export function origemPermitida(origin: string | undefined): boolean {
  if (!origin) return true;
  return (CORS_ORIGINS_PRINCIPAIS as string[]).includes(origin);
}
