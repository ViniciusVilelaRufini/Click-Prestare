/**
 * Normalização e validação de placa veicular (LPR).
 *
 * A placa chega da câmera em formato imprevisível ("ABC-1234", "abc1d23",
 * "ABC 1234") e no banco está como o usuário digitou. Comparar as duas cruas
 * erra o casamento; então tudo é reduzido à mesma forma canônica antes de
 * comparar.
 */

/** Só letras e dígitos, em maiúsculas. "abc-1d23" → "ABC1D23". */
export function normalizarPlaca(valor?: string | null): string {
  if (!valor) return '';
  return valor
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Placa brasileira válida: Mercosul (LLLNLNN) ou antiga (LLLNNNN).
 *
 * Serve de filtro contra lixo do OCR — leitura parcial ("AB1") ou com
 * caractere a mais não deve virar consulta nem evento negado no histórico.
 */
export function placaValida(placaNormalizada: string): boolean {
  const p = placaNormalizada;
  const mercosul = /^[A-Z]{3}\d[A-Z]\d{2}$/;
  const antiga = /^[A-Z]{3}\d{4}$/;
  return mercosul.test(p) || antiga.test(p);
}

/**
 * Formas equivalentes de escrever a mesma placa, para casar com o que está
 * gravado sem precisar varrer a tabela inteira.
 *
 * O banco guarda a placa como o morador digitou e não há coluna normalizada
 * (criar uma exigiria migração manual no Railway). Consultando por este
 * conjunto pequeno, o índice único (id_condominio, placa) continua sendo
 * usado — diferente de normalizar em SQL, que forçaria varredura completa.
 */
export function variantesPlaca(placaNormalizada: string): string[] {
  const p = placaNormalizada;
  if (!p) return [];
  const variantes = new Set<string>([p]);
  if (p.length === 7) {
    // Formato com hífen, comum no cadastro manual: "ABC-1D23".
    variantes.add(`${p.slice(0, 3)}-${p.slice(3)}`);
    // Formato com espaço, menos comum mas aparece em importação de planilha.
    variantes.add(`${p.slice(0, 3)} ${p.slice(3)}`);
  }
  return Array.from(variantes);
}
