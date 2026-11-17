/** Formato de e-mail aceito pelo CRM (mesmo critério em criar condomínio, síndico e edição). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Próxima ocorrência (estritamente depois de hoje) do dia de vencimento, entre 1 e 28. */
export function proximoVencimento(dia: number, agora: Date = new Date()): Date {
  const d = Math.min(28, Math.max(1, Math.trunc(Number(dia)) || 10));
  // "Hoje" é o dia civil de Brasília (UTC-3), não o do servidor (UTC): às 01:00Z ainda é o dia anterior.
  const brt = new Date(agora.getTime() - 3 * 3600 * 1000);
  const ano = brt.getUTCFullYear();
  const mes = brt.getUTCMonth();
  const hojeDia = brt.getUTCDate();
  return hojeDia < d ? new Date(ano, mes, d, 12) : new Date(ano, mes + 1, d, 12);
}
