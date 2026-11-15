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
  /** API nova: vale sobre a dedução por `vigente`/`substituido_em`. */
  situacao?: 'vigente' | 'substituido' | 'nao_conta' | null;
}

export type TipoSituacao = 'vigente' | 'substituido' | 'nao_conta';

/** Tooltip do "Não conta". */
export const MOTIVO_NAO_CONTA = 'Sem vínculo com a unidade ou registro duplicado';

export interface MapaVotacao {
  votacao: { id: number; titulo: string; somente_proprietarios?: number | boolean; encerrada_em?: string | null };
  participacao?: { unidades_votaram: number; unidades_total: number } | null;
  opcoes: { id: number; nome: string; votos: number }[];
  votos: VotoDoMapa[];
}

/**
 * Data/hora de Brasília para mostrar: "DD/MM/AAAA HH:mm" (ou com `:ss` quando `comSegundos`).
 * Aceita o texto que o mapa da API manda ("dd/MM/aaaa HH:mm:ss", já em Brasília) e ISO
 * (convertido para America/Sao_Paulo). Outro texto segue como veio; vazio se nulo.
 */
export function dataHoraBrasilia(v: string | null | undefined, comSegundos = false): string {
  const s = String(v ?? '').trim();
  const br = s.match(/^(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})(:\d{2})?$/);
  if (br) return comSegundos ? s : br[1];
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  const hm = `${p['day']}/${p['month']}/${p['year']} ${p['hour']}:${p['minute']}`;
  return comSegundos ? `${hm}:${p['second']}` : hm;
}

/**
 * Situação do voto no mapa. Usa `situacao` da API quando vem; senão deduz:
 * `vigente` → Vigente; `substituido_em` preenchido → Substituído; resto → Não conta
 * (voto antigo sem vínculo ou duplicata). Nunca "Substituído" sem a data.
 */
export function situacaoDoVoto(v: VotoDoMapa): { tipo: TipoSituacao; texto: string; rotuloCsv: string } {
  let tipo: TipoSituacao;
  const s = v?.situacao;
  if (s === 'vigente' || s === 'substituido' || s === 'nao_conta') tipo = s;
  else if (v?.vigente === true) tipo = 'vigente';
  else tipo = v?.substituido_em ? 'substituido' : 'nao_conta';
  if (tipo === 'substituido' && !v?.substituido_em) tipo = 'nao_conta';

  if (tipo === 'vigente') return { tipo, texto: 'Vigente', rotuloCsv: 'Vigente' };
  if (tipo === 'substituido') {
    return { tipo, texto: `Substituído em ${dataHoraBrasilia(v.substituido_em)}`, rotuloCsv: 'Substituído' };
  }
  return { tipo, texto: 'Não conta', rotuloCsv: 'Não conta' };
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
  const linhas = (m?.votos ?? []).map((v) => {
    const sit = situacaoDoVoto(v);
    return [
      v.unidade ?? '',
      v.votante ?? '',
      rotuloVinculo(v.tipo_vinculo),
      nomeOpcaoDoVoto(m, v),
      dataHoraBrasilia(v.registrado_em, true),
      sit.rotuloCsv,
      sit.tipo === 'substituido' ? dataHoraBrasilia(v.substituido_em, true) : '',
    ];
  });
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
