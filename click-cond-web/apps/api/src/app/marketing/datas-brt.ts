// Servidor roda em UTC, mas usuários e contas de anúncio operam em
// America/Sao_Paulo (BRT, UTC-3, sem horário de verão desde 2019). Estes
// helpers convertem entre os dois mundos sem depender de timezone do SO.
const OFFSET_BRT_MS = 3 * 60 * 60 * 1000;

/** Dia (YYYY-MM-DD) em BRT correspondente a um instante. */
export function diaBrt(d: Date): string {
  return new Date(d.getTime() - OFFSET_BRT_MS).toISOString().slice(0, 10);
}

/** Instante UTC correspondente a 00:00:00.000 BRT do dia informado (YYYY-MM-DD). */
export function inicioDiaBrt(dia: string): Date {
  return new Date(`${dia}T00:00:00.000-03:00`);
}

/** Instante UTC correspondente a 23:59:59.999 BRT do dia informado (YYYY-MM-DD). */
export function fimDiaBrt(dia: string): Date {
  return new Date(`${dia}T23:59:59.999-03:00`);
}
