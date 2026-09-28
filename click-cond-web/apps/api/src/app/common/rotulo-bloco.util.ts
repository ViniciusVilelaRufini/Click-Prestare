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
