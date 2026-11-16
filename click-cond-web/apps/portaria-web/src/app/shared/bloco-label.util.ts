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
  const nome = b.replace(/^bloco(?:\s+|$)/i, '').trim();
  return nome ? `Bloco ${nome}` : 'Bloco';
}
