/**
 * Status de ocorrência fechada — a mesma lista do app (mobile-auth.service).
 * O cartão do dashboard e o PDF de ocorrências contam "aberta" = fora dela.
 */
export const STATUS_SOLUCIONADO = ['Solucionado', 'solucionado', 'Resolvida', 'resolvida'] as const;

/** A ocorrência está fechada (qualquer grafia gravada de "solucionado"). */
export function ocorrenciaSolucionada(status: string | null | undefined): boolean {
  return (STATUS_SOLUCIONADO as readonly string[]).includes(String(status ?? ''));
}
