/**
 * Rótulo de um bloco para exibição: "Bloco A".
 *
 * O cadastro guarda o nome do bloco das duas formas ("A" ou "Bloco A"), então
 * concatenar "Bloco " direto no template mostrava "Bloco Bloco A". Aqui o
 * prefixo "bloco" (palavra inteira, qualquer caixa) é tirado e recolocado uma
 * única vez, com os espaços normalizados. Vazio/nulo devolve ''.
 */
export function rotuloBloco(bloco: string | null | undefined): string {
  const b = String(bloco ?? '').replace(/\s+/g, ' ').trim();
  if (!b) return '';
  // "Quadra A" e "Torre 2" já são o rótulo: prefixar "Bloco" daria "Bloco Quadra A".
  if (/^(quadra|torre)(?:\s|$)/i.test(b)) return b;
  const nome = b.replace(/^bloco(?:\s+|$)/i, '').trim();
  return nome ? `Bloco ${nome}` : 'Bloco';
}

/**
 * Chave de agrupamento do bloco: minúsculas e sem o prefixo "bloco", "quadra"
 * ou "torre" — "A", "Bloco A" e "Quadra A" caem no mesmo grupo (mesma regra da API).
 */
export function chaveBloco(bloco: string | null | undefined): string {
  return String(bloco ?? '').trim().toLowerCase().replace(/^(bloco|quadra|torre)\s*/, '');
}
