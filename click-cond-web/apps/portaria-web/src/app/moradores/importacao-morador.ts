/**
 * Data de nascimento lida da planilha de importação, em AAAA-MM-DD.
 * - Célula de data do Excel chega como número de série (dias desde 30/12/1899).
 * - Texto: DD/MM/AAAA (dia e mês com 1 ou 2 dígitos) ou AAAA-MM-DD (com ou sem hora).
 * Vazio → ''. Outro formato volta como veio: a API recusa a linha explicando o formato.
 */
/** Série 10000 do Excel = 18/05/1927. Abaixo disso o número não é tratado como data de nascimento. */
const SERIE_MINIMA = 10000;

export function dataNascimentoDaPlanilha(valor: unknown): string {
  if (valor == null) return '';
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    // Só é data de série do Excel num intervalo plausível de nascimento: de 10000 (1927) até hoje.
    // Um número como 1985 (ano solto) volta como texto e a API recusa a linha pedindo DD/MM/AAAA.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86400000);
    if (valor < SERIE_MINIMA || d.getTime() > Date.now()) return String(valor);
    return d.toISOString().slice(0, 10);
  }
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${valor.getFullYear()}-${p(valor.getMonth() + 1)}-${p(valor.getDate())}`;
  }
  const s = String(valor).trim();
  if (!s) return '';
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);
  if (iso) return iso[1];
  return s;
}

/** A linha tem uma data no formato que a API aceita (sem ela, o morador entra sem acesso ao app). */
export function temDataNascimento(data: string | null | undefined): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(data ?? '');
}

/**
 * Vinculo lido da planilha: 'proprietario' | 'inquilino' | 'dependente', ou null quando vazio/desconhecido.
 * Nao ha padrao silencioso: o vinculo define quem vota em pauta "somente proprietarios".
 */
export function vinculoDaPlanilha(valor: unknown): 'proprietario' | 'inquilino' | 'dependente' | null {
  const t = String(valor ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  // Como a API (normalizarTipoVinculo): 'morador' e 'titular' são o proprietário; 'membro', o dependente.
  if (t.startsWith('proprietari') || t === 'morador' || t === 'titular') return 'proprietario';
  if (t.startsWith('inquilin')) return 'inquilino';
  if (t.startsWith('dependent') || t === 'membro') return 'dependente';
  return null;
}

export interface ErroVinculoPlanilha {
  /** Número da linha na planilha (cabeçalho é a 1). */
  linha: number;
  nome: string;
  /** O que estava na célula ('' quando a coluna/valor não existe). */
  valor: string;
}

/**
 * Separa as linhas com Vínculo reconhecido das demais. Sem padrão silencioso:
 * se houver qualquer linha vazia/desconhecida (inclusive coluna Vínculo
 * ausente), `erros` lista todas e a importação não deve seguir.
 */
export function validarVinculosDaPlanilha<T extends { nome: string; tipo?: unknown }>(
  linhas: T[],
): { validas: (T & { tipo: 'proprietario' | 'inquilino' | 'dependente' })[]; erros: ErroVinculoPlanilha[] } {
  const validas: (T & { tipo: 'proprietario' | 'inquilino' | 'dependente' })[] = [];
  const erros: ErroVinculoPlanilha[] = [];
  linhas.forEach((l, i) => {
    const v = vinculoDaPlanilha(l.tipo);
    if (v) validas.push({ ...l, tipo: v });
    else erros.push({ linha: i + 2, nome: String(l.nome ?? ''), valor: String(l.tipo ?? '').trim() });
  });
  return { validas, erros };
}
