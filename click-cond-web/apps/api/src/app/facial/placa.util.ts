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
 * Pares que o OCR da câmera confunde por terem o mesmo desenho: 0/O, 1/I, 8/B,
 * 5/S, 2/Z e 6/G. Lista curta de propósito, e um para um — cada dígito tem UMA
 * letra e vice-versa, então a correção nunca precisa escolher entre candidatos.
 * Ficam de fora os pares mais fracos (0/Q, 0/D, 7/T, 4/A), que quebrariam isso.
 */
const DIGITO_PARA_LETRA: Record<string, string> = {
  '0': 'O',
  '1': 'I',
  '8': 'B',
  '5': 'S',
  '2': 'Z',
  '6': 'G',
};
const LETRA_PARA_DIGITO: Record<string, string> = Object.fromEntries(
  Object.entries(DIGITO_PARA_LETRA).map(([digito, letra]) => [letra, digito]),
);

/** Índices (base 0) que só admitem letra e os que só admitem dígito. */
const POSICOES_LETRA = [0, 1, 2];
const POSICOES_DIGITO = [3, 5, 6];

/**
 * OCR erra um caractere, às vezes dois. Leitura que precisa de mais trocas que
 * isso é ruído (telefone pintado num caminhão) e não deve ser promovida a placa.
 */
const MAX_TROCAS_OCR = 2;

/**
 * Desfaz a troca de caractere parecido feita pelo OCR, usando a posição.
 *
 * A placa brasileira é tipada: 1ª a 3ª posição só letra; 4ª, 6ª e 7ª só dígito.
 * Um dígito em posição de letra (ou o contrário) só pode ser erro de leitura,
 * e é trocado pelo par dele. A 5ª posição é dígito na antiga e letra na
 * Mercosul: "ABC1O23" e "ABC1023" são duas placas válidas e diferentes, então
 * ela nunca é tocada.
 *
 * Garantias:
 *  - leitura que já é placa válida volta igual (nas posições tipadas não há o
 *    que trocar), logo nunca vira OUTRA placa válida;
 *  - só devolve algo diferente da entrada se o resultado for placa válida;
 *    senão devolve a entrada como veio, e `placaValida` segue recusando.
 *
 * Vale só para a LEITURA da câmera — não usar em cadastro.
 */
export function corrigirPlacaOcr(placaNormalizada: string): string {
  const p = placaNormalizada;
  if (!p || p.length !== 7 || placaValida(p)) return p;

  const caracteres = p.split('');
  let trocas = 0;
  for (const i of POSICOES_LETRA) {
    const letra = DIGITO_PARA_LETRA[caracteres[i]];
    if (letra) {
      caracteres[i] = letra;
      trocas++;
    }
  }
  for (const i of POSICOES_DIGITO) {
    const digito = LETRA_PARA_DIGITO[caracteres[i]];
    if (digito) {
      caracteres[i] = digito;
      trocas++;
    }
  }
  if (trocas === 0 || trocas > MAX_TROCAS_OCR) return p;

  const corrigida = caracteres.join('');
  return placaValida(corrigida) ? corrigida : p;
}

/**
 * Formas equivalentes de escrever a mesma placa, para casar com o que está
 * gravado sem precisar varrer a tabela inteira.
 *
 * O banco guarda a placa como o morador digitou e não há coluna normalizada
 * (criar uma exigiria migração manual no Railway). Consultando por este
 * conjunto pequeno, o índice único (id_condominio, placa) continua sendo
 * usado — diferente de normalizar em SQL, que forçaria varredura completa.
 *
 * Leitura com caractere trocado pelo OCR ("ABC10O3") entra também na forma
 * corrigida ("ABC1003"), que é a que está no cadastro. O cadastro não muda.
 */
export function variantesPlaca(placaNormalizada: string): string[] {
  const p = placaNormalizada;
  if (!p) return [];
  const variantes = new Set<string>();
  for (const placa of new Set([p, corrigirPlacaOcr(p)])) {
    variantes.add(placa);
    if (placa.length === 7) {
      // Formato com hífen, comum no cadastro manual: "ABC-1D23".
      variantes.add(`${placa.slice(0, 3)}-${placa.slice(3)}`);
      // Formato com espaço, menos comum mas aparece em importação de planilha.
      variantes.add(`${placa.slice(0, 3)} ${placa.slice(3)}`);
    }
  }
  return Array.from(variantes);
}
