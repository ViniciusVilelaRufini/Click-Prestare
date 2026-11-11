/**
 * Código de tag (RFID/UHF) — normalização e equivalências.
 *
 * O mesmo cartão chega com representações diferentes: o número impresso
 * (decimal, com zeros à esquerda), o que o leitor manda (hex, decimal ou
 * Wiegand 26 "facility,número") e o que foi digitado no cadastro. Wiegand só
 * é reconhecido COM separador: ler um decimal de 6-8 dígitos como "facility +
 * número colados" era palpite e casava com o cartão de outra pessoa. Comparar
 * por igualdade de texto fazia a tag cadastrada nunca casar com a leitura.
 *
 * - Cadastro grava `normalizarCodigoTag`.
 * - Leitura compara com `gruposCodigoTag`: primeiro as `exatas`; as
 *   `convertidas` (troca de base / Wiegand) só valem se a exata não achar
 *   ninguém, porque um código só de dígitos também é hex válido.
 */

/** Tamanho máximo aceito na entrada (EPC de 96 bits tem 24 hex; folga larga). */
export const TAG_CODIGO_MAX = 64;

const MAX_24_BITS = (BigInt(1) << BigInt(24)) - BigInt(1);
const DOIS_16 = BigInt(65536);

function textoDe(bruto: unknown): string | null {
  if (
    typeof bruto !== 'string' &&
    typeof bruto !== 'number' &&
    typeof bruto !== 'bigint'
  ) {
    return null;
  }
  const texto = String(bruto).trim();
  if (!texto || texto.length > TAG_CODIGO_MAX) return null;
  return texto;
}

/** Wiegand 26 escrito com separador ("188,24910"): valor de 24 bits, ou null. */
function wiegandComSeparador(texto: string): bigint | null {
  const m = /^(\d{1,3})\s*[,.]\s*(\d{1,5})$/.exec(texto);
  if (!m) return null;
  return montarWiegand(m[1], m[2]);
}

function montarWiegand(facility: string, numero: string): bigint | null {
  const f = Number(facility);
  const n = Number(numero);
  if (f > 255 || n > 65535) return null;
  return BigInt(f) * DOIS_16 + BigInt(n);
}

function semZerosAEsquerda(s: string): string {
  return s.replace(/^0+(?=.)/, '');
}

/**
 * Forma canônica do código, para gravar no cadastro: maiúsculas; sem espaços,
 * ":" e "-"; sem zeros à esquerda (sobra ao menos um caractere).
 *
 * Wiegand 26 com separador ("188,24910") vira o decimal do valor de 24 bits —
 * sem isso o formato impresso em muitos cartões seria recusado pela vírgula.
 *
 * Devolve null para vazio, grande demais ou com caractere fora de [0-9A-Z].
 */
export function normalizarCodigoTag(bruto: unknown): string | null {
  const texto = textoDe(bruto);
  if (!texto) return null;

  const wiegand = wiegandComSeparador(texto);
  if (wiegand !== null) return wiegand.toString(10);

  const limpo = texto.toUpperCase().replace(/[\s:-]/g, '');
  if (!limpo || !/^[0-9A-Z]+$/.test(limpo)) return null;
  return semZerosAEsquerda(limpo);
}

export interface GruposCodigoTag {
  /** Forma canônica, ou null se a leitura não é um código válido. */
  normalizado: string | null;
  /** Igualdade exata: o normalizado e o texto como chegou (cadastro antigo). */
  exatas: string[];
  /** Mesma tag em outra base/formato (decimal x hex x Wiegand 26). */
  convertidas: string[];
}

/** Representações de um valor numérico: decimal, hex e, se couber, Wiegand 26. */
function formasDoValor(valor: bigint): string[] {
  const decimal = valor.toString(10);
  const formas = [decimal, valor.toString(16).toUpperCase()];
  // Número impresso em cartão de proximidade: 10 dígitos com zeros à esquerda.
  if (decimal.length < 10) formas.push(decimal.padStart(10, '0'));
  if (valor <= MAX_24_BITS) {
    const facility = (valor / DOIS_16).toString(10);
    const numero = (valor % DOIS_16).toString(10).padStart(5, '0');
    formas.push(`${facility},${numero}`, `${facility.padStart(3, '0')},${numero}`);
  }
  return formas;
}

export function gruposCodigoTag(bruto: unknown): GruposCodigoTag {
  const texto = textoDe(bruto);
  if (!texto) return { normalizado: null, exatas: [], convertidas: [] };

  const normalizado = normalizarCodigoTag(texto);
  // Cadastro antigo pode ter caractere que hoje seria recusado: continua
  // casando pela igualdade do texto como chegou.
  if (!normalizado) return { normalizado: null, exatas: [texto], convertidas: [] };

  const exatas = [...new Set([normalizado, texto])];

  const valores: bigint[] = [];
  const wiegand = wiegandComSeparador(texto);
  if (wiegand !== null) {
    valores.push(wiegand);
  } else {
    if (/^\d+$/.test(normalizado)) valores.push(BigInt(normalizado));
    if (/^[0-9A-F]+$/.test(normalizado)) valores.push(BigInt('0x' + normalizado));
  }

  const convertidas = new Set<string>();
  for (const valor of valores) {
    for (const forma of formasDoValor(valor)) {
      if (!exatas.includes(forma)) convertidas.add(forma);
    }
  }
  return { normalizado, exatas, convertidas: [...convertidas] };
}

/**
 * Todas as representações equivalentes da leitura, com o normalizado primeiro.
 * Para decidir acesso use `gruposCodigoTag` (prioridade da igualdade exata).
 */
export function variantesCodigoTag(bruto: unknown): string[] {
  const { exatas, convertidas } = gruposCodigoTag(bruto);
  return [...exatas, ...convertidas];
}

/**
 * Para os pontos de CADASTRO: devolve o código normalizado ou a mensagem de
 * erro a mostrar. `maximo` é o tamanho da coluna de destino.
 */
export function validarCodigoTag(
  bruto: unknown,
  maximo = TAG_CODIGO_MAX,
): { codigo: string; erro?: undefined } | { codigo?: undefined; erro: string } {
  // Só string ou number: um array ['12','34'] virava "12,34" no String() e era
  // lido como Wiegand com separador.
  if (bruto != null && typeof bruto !== 'string' && typeof bruto !== 'number') {
    return {
      erro: 'Código de tag inválido: use apenas letras e números (espaços, ":" e "-" são ignorados).',
    };
  }
  const texto = bruto == null ? '' : String(bruto).trim();
  if (!texto) return { erro: 'Informe o código da tag.' };
  const codigo = normalizarCodigoTag(texto);
  if (!codigo) {
    return {
      erro:
        texto.length > TAG_CODIGO_MAX
          ? `Código de tag muito longo (máximo de ${TAG_CODIGO_MAX} caracteres).`
          : 'Código de tag inválido: use apenas letras e números (espaços, ":" e "-" são ignorados).',
    };
  }
  if (codigo.length > maximo) {
    return { erro: `Código de tag muito longo (máximo de ${maximo} caracteres).` };
  }
  return { codigo };
}
