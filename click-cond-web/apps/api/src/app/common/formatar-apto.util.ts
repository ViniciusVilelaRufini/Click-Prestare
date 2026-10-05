/**
 * Formata o rótulo de apartamento e bloco para exibição no dashboard.
 * Casos:
 * - Sem bloco: "Apto 108"
 * - Bloco começando com "bloco" (case-insensitive): mantém como-está; bloco curto ou sem "Bloco" recebe prefixo
 * - Bloco curto (letra simples, ex. "A"): "Bloco A"
 * - Ambos vazios/nulos: string vazia
 * - Apto vazio, bloco preenchido: prefixado com "Bloco " se necessário (ex. "A" → "Bloco A")
 *
 * Regra de prefixação do bloco:
 * - Se não começa com "bloco" (case-insensitive), adiciona prefixo "Bloco "
 * - Se já começa com "bloco" em qualquer caso, não duplica prefixo
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

  // Normaliza o bloco com prefixo "Bloco " se necessário
  const blocoPrefixado = blocoTrimmed.toLowerCase().startsWith('bloco')
    ? blocoTrimmed
    : `Bloco ${blocoTrimmed}`;

  // Se só bloco (apto vazio), retorna bloco prefixado
  if (!aptoTrimmed) {
    return blocoPrefixado;
  }

  // Ambos preenchidos: usa o separador " · "
  return `Apto ${aptoTrimmed} · ${blocoPrefixado}`;
}
