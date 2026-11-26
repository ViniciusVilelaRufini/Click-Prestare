/**
 * Rótulo da unidade para exibição: "Bloco A · Apto 101" (bloco primeiro, como
 * o console mostra), "Apto 101" sem bloco, "Bloco A" sem apto, '' sem nada.
 * O bloco cadastrado como "Bloco A" não ganha prefixo duplicado ("Bloco Bloco A").
 */
export function formatarApto(apto: string | null | undefined, bloco: string | null | undefined): string {
  const a = (apto ?? '').trim();
  const b = (bloco ?? '').trim();
  if (!a && !b) return '';
  const blocoPrefixado = b ? (/^bloco\b/i.test(b) ? b : `Bloco ${b}`) : '';
  const aptoTxt = a ? `Apto ${a}` : '';
  return [blocoPrefixado, aptoTxt].filter(Boolean).join(' · ');
}
