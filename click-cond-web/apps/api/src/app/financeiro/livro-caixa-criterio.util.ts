/**
 * Critério do Livro Caixa compartilhado com o relatório financeiro (PDF/XLSX).
 *
 * As duas saídas precisam fechar no mesmo número: o que é taxa condominial
 * apto a apto, o que conta no saldo e com que sinal. Ficava duplicado (e
 * divergente) entre financeiro.service e relatorios.service.
 */

export interface UnidadeDoCondominio {
  apto: string | null;
  bloco: string | null;
}

/**
 * O nome do lançamento aponta para este apartamento ("Apto X [Bloco Y] - ...")?
 *
 * Apartamento precisa estar entre "Apto " e o PRÓXIMO CAMPO do nome. `\b`
 * sozinho não basta: ele barra dígito colado ("101" não casa com apto "10"),
 * mas deixa passar pontuação colada — "10.1", "10-A" e "10/2" também têm `\b`
 * logo depois do "10", e o boleto do vizinho vazava.
 *
 * Exigir só `(?=\s|$)` também não basta, porque o espaço é separador dos
 * campos mas não é proibido DENTRO do valor: `assertAptoValido` aceita "10 A"
 * e `normalizarUnidade` devolve identificação não numérica verbatim, então
 * "Apto 10 A - Ref..." existe de verdade — e casava com o apto "10", que é o
 * mesmo vazamento por outro caminho.
 *
 * Os três produtores de nome ("Apto X [Bloco Y] - Ref. MM/AAAA",
 * "... - Rateio: ...", "... - Acordo Parc. i/n") só encerram o token do apto de
 * dois jeitos: seguido de " Bloco " ou do " - " que abre o sufixo. Ancorar
 * nisso é o que distingue o valor do separador.
 */
export function nomeFaturaDeApto(
  nome: string | null | undefined,
  apto: string | null | undefined,
  bloco: string | null | undefined,
): boolean {
  if (!nome || !apto) return false;
  // Escapa caracteres regex no apto/bloco (defensivo — apto pode ter
  // hífen ou outros símbolos em alguns condomínios).
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aptoEsc = escape(apto.trim());
  const aptoRegex = new RegExp(`\\bApto\\s+${aptoEsc}(?=\\s+Bloco\\s|\\s*-\\s|$)`, 'i');
  if (!aptoRegex.test(nome)) return false;

  // Se bloco informado, valida também. Se vazio/null, aceita lançamento
  // sem bloco (apartamento sem bloco em condomínios pequenos). Mesmo
  // raciocínio do apto, e o bloco tem o mesmo defeito: "Bloco A B" casava
  // com o bloco "A". O bloco é sempre o último campo antes do " - ", então
  // é só nele (ou no fim da string) que o token pode terminar.
  const blocoNorm = bloco?.trim() ?? '';
  if (blocoNorm) {
    const blocoEsc = escape(blocoNorm);
    const blocoRegex = new RegExp(`\\bBloco\\s+${blocoEsc}(?=\\s*-\\s|$)`, 'i');
    return blocoRegex.test(nome);
  }
  // Sem bloco no perfil: aceita só se o nome também não tiver bloco
  // ("Apto 5 - Ref. 03/2026" sem "Bloco").
  return !/\bBloco\s+\S/i.test(nome);
}

/**
 * Taxa de morador (cobrança apto a apto): tipo 'C' cujo nome aponta para um
 * apartamento real do condomínio — o mesmo reconhecimento da Inadimplência.
 * O Livro Caixa (tela e CSV) a esconde por padrão; o relatório financeiro
 * também.
 */
export function ehTaxaCondominialDeApto(
  lancamento: { tipo?: string | null; nome?: string | null },
  aptosDoCondominio: UnidadeDoCondominio[],
): boolean {
  return (
    lancamento.tipo === 'C' &&
    aptosDoCondominio.some((a) => nomeFaturaDeApto(lancamento.nome, a.apto, a.bloco))
  );
}

/**
 * Cobrança substituída pelas parcelas de um acordo (`status = '3'`). A
 * Inadimplência a exclui; o relatório financeiro também. Comparação na
 * aplicação de propósito: `status: { not: '3' }` no Prisma também descarta
 * `status` nulo, e o Livro Caixa mostra esses lançamentos.
 */
export function lancamentoRenegociado(lancamento: { status?: string | null }): boolean {
  return lancamento.status === '3';
}

/**
 * Despesa no Livro Caixa: só `tipo = 'D'`. Todo o resto (inclusive 'c'/'d'
 * minúsculos e tipo nulo) entra como receita — é a regra que o saldo sempre
 * usou, agora também para separar receitas de despesas nos totais (o getAll
 * somava o tipo nulo como despesa e o subtraía do saldo como receita).
 */
export function ehDespesaNoLivroCaixa(lancamento: { tipo?: string | null }): boolean {
  return lancamento.tipo === 'D';
}

/** Valor com o sinal do Livro Caixa: despesa sai, o resto entra. */
export function valorNoLivroCaixa(lancamento: { tipo?: string | null; valor?: unknown }): number {
  const v = Math.abs(lancamento.valor ? Number(lancamento.valor) : 0);
  return ehDespesaNoLivroCaixa(lancamento) ? -v : v;
}

/** Conta no saldo do Livro Caixa: só o que está pago. */
export function lancamentoPago(lancamento: { pago?: number | null }): boolean {
  return lancamento.pago === 1;
}
