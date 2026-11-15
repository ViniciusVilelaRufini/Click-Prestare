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
