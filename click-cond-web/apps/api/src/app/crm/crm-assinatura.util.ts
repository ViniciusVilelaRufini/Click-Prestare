/** Formato de e-mail aceito pelo CRM (mesmo critério em criar condomínio, síndico e edição). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Próxima ocorrência (estritamente depois de hoje) do dia de vencimento, entre 1 e 28. */
export function proximoVencimento(dia: number, hoje: Date = new Date()): Date {
  const d = Math.min(28, Math.max(1, Math.trunc(Number(dia)) || 10));
  const esteMes = new Date(hoje.getFullYear(), hoje.getMonth(), d, 12);
  return esteMes.getTime() > hoje.getTime() && hoje.getDate() < d
    ? esteMes
    : new Date(hoje.getFullYear(), hoje.getMonth() + 1, d, 12);
}
