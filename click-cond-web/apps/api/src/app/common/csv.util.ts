/**
 * Uma célula de CSV. Além do escape de vírgula/ponto e vírgula/aspas/quebra de linha,
 * neutraliza fórmula: texto de terceiros (nome de visitante, descrição vinda
 * do ERP) começando com = + - @ TAB ou CR vira fórmula ativa no Excel e no
 * LibreOffice. O apóstrofo na frente faz a planilha tratar como texto.
 * Número negativo formatado ("-R$ 250,00", "-12,50") não é fórmula e passa.
 */
export function csvCelula(value: unknown): string {
  if (value == null) return '';
  let str = String(value);
  const numeroNegativo = /^-\s*(R\$\s*)?[\d.,]+$/.test(str);
  if (/^[=+\-@\t\r]/.test(str) && !numeroNegativo) {
    str = "'" + str;
  }
  // `;` também: é o separador dos CSVs abertos no Excel em pt-BR (SEPARADOR_CSV).
  if (/[",;\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Separador dos CSVs que o síndico abre no Excel: em pt-BR a vírgula é o
 * separador decimal e o Excel abre um CSV com vírgula com tudo numa coluna só.
 */
export const SEPARADOR_CSV = ';';

/** Uma linha de CSV com `SEPARADOR_CSV`, cada célula passando por `csvCelula`. */
export function linhaCsv(celulas: readonly unknown[]): string {
  return celulas.map((c) => csvCelula(c)).join(SEPARADOR_CSV);
}
