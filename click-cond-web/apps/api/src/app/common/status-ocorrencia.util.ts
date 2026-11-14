/**
 * Status de ocorrência fechada, em todas as grafias já gravadas — a lista
 * única: o cartão do dashboard e o PDF contam "aberta" = fora dela, e o
 * atendimento (ocorrencias.service) reabre a partir dela.
 */
export const STATUS_SOLUCIONADO = [
  'Solucionado', 'solucionado',
  'Solucionada', 'solucionada',
  'Resolvida', 'resolvida',
  'Resolvido', 'resolvido',
] as const;

/** A ocorrência está fechada (qualquer grafia gravada de "solucionado", sem diferença de caixa/espaços). */
export function ocorrenciaSolucionada(status: string | null | undefined): boolean {
  const n = String(status ?? '').trim().toLowerCase();
  return (STATUS_SOLUCIONADO as readonly string[]).some((s) => s.toLowerCase() === n);
}
