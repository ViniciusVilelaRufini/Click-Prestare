/**
 * Rótulo do bloco para textos exibidos (auditoria, avisos, convites). Há
 * condomínios com o bloco cadastrado como "Bloco A" e outros só como "A";
 * prefixar sempre gerava "Bloco Bloco A".
 *
 * Não use em chaves de busca (nomes de fatura do financeiro): lá o texto
 * antigo precisa continuar batendo com o que já está gravado.
 */
export function rotuloBloco(bloco: string | null | undefined): string {
  const s = (bloco ?? '').trim();
  if (!s) return '';
  return /^bloco\b/i.test(s) ? s : `Bloco ${s}`;
}

/**
 * Chave de comparação do bloco: sem espaços nas pontas, minúsculas e sem o
 * prefixo "bloco", "quadra" ou "torre" ("Bloco A", "Quadra A" e "A" são o
 * mesmo bloco; "Bloco 10" continua diferente de "Bloco 1").
 */
export function normalizarBloco(bloco: string | null | undefined): string {
  const s = (bloco ?? '').trim().toLowerCase();
  // O prefixo só conta se vier colado em espaço, número ou ponto; sozinho ("Quadra") continua sendo o nome.
  return s.replace(/^(bloco|quadra|torre)(?=[\s\d.]|$)\.?\s*/, '') || (/^(quadra|torre)$/.test(s) ? s : '');
}

/**
 * Chave de comparação da unidade: sem o prefixo "lote", "casa", "apto"
 * (com ou sem ponto), "apartamento" ou "unidade", sem espaços e, quando só
 * há números, sem zeros à esquerda ("0101" e "Apto 101" são "101"; "0" fica "0").
 */
export function normalizarApto(apto: string | null | undefined): string {
  const bruto = (apto ?? '').trim().toLowerCase();
  const semPrefixo = bruto.replace(/^(lote|casa|apto|apartamento|unidade)(?=[\s\d.]|$)\.?\s*/, '');
  const s = (semPrefixo || bruto).replace(/\s+/g, '');
  return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s;
}

/** Chave única da unidade (bloco + apto) para comparar cadastro, importação e planilha. */
export function chaveUnidade(bloco: string | null | undefined, apto: string | null | undefined): string {
  return `${normalizarBloco(bloco)}|${normalizarApto(apto)}`;
}

/** "Apto 12 Bloco A" para textos exibidos; sem bloco só "Apto 12" (nunca "Bloco null"). */
export function textoUnidade(apto: string | null | undefined, bloco: string | null | undefined): string {
  const r = rotuloBloco(bloco);
  return `Apto ${(apto ?? '').trim()}${r ? ` ${r}` : ''}`;
}
