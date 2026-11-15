/**
 * Mapa de votação (nominal): só síndico/equipe, só de votação encerrada.
 * Formato de `GET assembleias/votacoes/mapa?id=` (rodada 5).
 */
export interface VotoDoMapa {
  unidade: string;
  votante: string | null;
  tipo_vinculo: string | null;
  /** Nome da opção (ou o id, que é traduzido pelo `opcoes`). */
  opcao: string | number | null;
  registrado_em: string | null;
  vigente: boolean;
  substituido_em: string | null;
}

export interface MapaVotacao {
  votacao: { id: number; titulo: string; somente_proprietarios?: number | boolean; encerrada_em?: string | null };
  participacao?: { unidades_votaram: number; unidades_total: number } | null;
  opcoes: { id: number; nome: string; votos: number }[];
  votos: VotoDoMapa[];
}

/** ISO → "DD/MM/AAAA HH:mm" no horário de Brasília; outro texto segue como veio; vazio se nulo. */
export function dataHoraBrasilia(v: string | null | undefined): string {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p['day']}/${p['month']}/${p['year']} ${p['hour']}:${p['minute']}`;
}

/** "proprietario" → "Proprietário"; vazio quando não veio. */
export function rotuloVinculo(t: string | null | undefined): string {
  switch (String(t ?? '').trim().toLowerCase()) {
    case 'proprietario': return 'Proprietário';
    case 'inquilino': return 'Inquilino';
    case 'membro': return 'Membro';
    default: return String(t ?? '').trim();
  }
}

/** Nome da opção do voto: se vier o id, troca pelo nome da lista de opções. */
export function nomeOpcaoDoVoto(m: MapaVotacao, voto: VotoDoMapa): string {
  const bruto = voto?.opcao;
  if (bruto === null || bruto === undefined) return '';
  const porId = (m?.opcoes ?? []).find((o) => String(o.id) === String(bruto));
  return porId ? porId.nome : String(bruto);
}

/** Campo do CSV entre aspas, com aspas dobradas e fórmula neutralizada (=, +, -, @ no início). */
function campoCsv(v: string): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Marca de ordem de bytes: sem ela o Excel abre o UTF-8 como Latin-1 (acentos quebrados). */
const BOM = String.fromCharCode(0xfeff);

/** CSV do mapa para o Excel pt-BR: BOM UTF-8, ';' como separador, CRLF. */
export function csvMapaVotacao(m: MapaVotacao): string {
  const cab = ['Unidade', 'Votante', 'Vínculo', 'Opção', 'Registrado em', 'Situação', 'Substituído em'];
  const linhas = (m?.votos ?? []).map((v) => [
    v.unidade ?? '',
    v.votante ?? '',
    rotuloVinculo(v.tipo_vinculo),
    nomeOpcaoDoVoto(m, v),
    dataHoraBrasilia(v.registrado_em),
    v.vigente === false ? 'Substituído' : 'Vigente',
    v.vigente === false ? dataHoraBrasilia(v.substituido_em) : '',
  ]);
  return BOM + [cab, ...linhas].map((l) => l.map(campoCsv).join(';')).join('\r\n');
}

/** Nome do arquivo: "mapa-votacao-<id>-<titulo-sem-acento>.csv". */
export function nomeArquivoMapa(m: MapaVotacao): string {
  const slug = String(m?.votacao?.titulo ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `mapa-votacao-${m?.votacao?.id ?? ''}${slug ? '-' + slug : ''}.csv`;
}
