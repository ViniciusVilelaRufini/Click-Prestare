/**
 * Formata o rótulo de apartamento e bloco para exibição no dashboard.
 * Casos:
 * - Sem bloco: "Apto 108"
 * - Bloco começando com "bloco" (case-insensitive): "Apto 108 · Bloco A"
 * - Bloco curto (letra simples): "Apto 108 · A"
 * - Ambos vazios/nulos: string vazia
 * - Apto vazio, bloco preenchido: só o bloco (sem "Apto ")
 *
 * Sempre usa " · " (middle dot com espaços) como separador.
 */
export function formatarApto(apto: string | null | undefined, bloco: string | null | undefined): string {
  const aptoTrimmed = (apto ?? '').trim();
  const blocoTrimmed = (bloco ?? '').trim();

  // Se ambos vazios, retorna vazio
  if (!aptoTrimmed && !blocoTrimmed) {
    return '';
  }

  // Se só apto, retorna "Apto X"
  if (aptoTrimmed && !blocoTrimmed) {
    return `Apto ${aptoTrimmed}`;
  }

  // Se só bloco, retorna só o bloco
  if (!aptoTrimmed && blocoTrimmed) {
    return blocoTrimmed;
  }

  // Ambos preenchidos: usa o separador " · "
  return `Apto ${aptoTrimmed} · ${blocoTrimmed}`;
}
