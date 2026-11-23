/**
 * Apuração da receita bruta dos últimos 12 meses (RBT12) a partir das faturas
 * (LC 123/2006, art. 18, §§ 1º e 2º). Funções puras, sem dependência de Angular.
 */

export interface FaturaReceita { referencia: string; valor: number } // referencia 'MM/AAAA'

export interface ApuracaoReceita {
  mesApuracao: string;       // 'MM/AAAA'
  receitaMes: number;        // faturas do próprio mês
  rbt12: number;             // 12 meses anteriores (ou proporcionalizada)
  mesesConsiderados: number; // meses de atividade dentro da janela
  proporcionalizada: boolean;
  semDados: boolean;         // nenhuma fatura no mês nem na janela
}

const REFERENCIA = /^(0[1-9]|1[0-2])\/(\d{4})$/;

/** Converte 'MM/AAAA' em índice ano*12 + (mês-1); null se malformada. */
function indiceMes(referencia: string | null | undefined): number | null {
  const m = typeof referencia === 'string' ? REFERENCIA.exec(referencia) : null;
  return m ? Number(m[2]) * 12 + (Number(m[1]) - 1) : null;
}

function arredondar(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

export function apurarReceita(
  faturas: FaturaReceita[],
  mesApuracao: string,
  inicioAtividade: string | null,
): ApuracaoReceita {
  const alvo = indiceMes(mesApuracao);
  if (alvo === null) {
    return { mesApuracao, receitaMes: 0, rbt12: 0, mesesConsiderados: 0, proporcionalizada: false, semDados: true };
  }

  const validas = faturas
    .map((x) => ({ indice: indiceMes(x.referencia), valor: Number(x.valor) || 0 }))
    .filter((x): x is { indice: number; valor: number } => x.indice !== null);

  const inicioInformado = indiceMes(inicioAtividade);
  const inicio = inicioInformado ?? (validas.length ? Math.min(...validas.map((x) => x.indice)) : alvo);

  const inicioJanela = alvo - 12;
  const primeiroMes = Math.max(inicio, inicioJanela);
  const n = Math.max(0, alvo - primeiroMes);

  const daJanela = validas.filter((x) => x.indice >= inicioJanela && x.indice < alvo);
  const doMes = validas.filter((x) => x.indice === alvo);
  const somaJanela = daJanela.filter((x) => x.indice >= inicio).reduce((s, x) => s + x.valor, 0);
  const receitaMes = doMes.reduce((s, x) => s + x.valor, 0);

  let rbt12: number;
  if (n >= 12) rbt12 = somaJanela;
  else if (n === 0) rbt12 = receitaMes * 12;
  else rbt12 = (somaJanela / n) * 12;

  return {
    mesApuracao,
    receitaMes: arredondar(receitaMes),
    rbt12: arredondar(rbt12),
    mesesConsiderados: n,
    proporcionalizada: n < 12,
    semDados: daJanela.length === 0 && doMes.length === 0,
  };
}

/** Mês corrente 'MM/AAAA' no fuso America/Sao_Paulo. */
export function mesAtualBrasilia(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(agora);
  const ano = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  return `${mes}/${ano}`;
}
