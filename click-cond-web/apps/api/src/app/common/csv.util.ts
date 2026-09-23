/**
 * Uma célula de CSV. Além do escape de vírgula/aspas/quebra de linha,
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
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
