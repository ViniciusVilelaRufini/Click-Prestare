import { TOLERANCIA_JANELA_MS, prazoAutorizacaoRemotaMs } from '../common/janela-visita';

/**
 * Qual visita da pessoa vale no terminal agora, e qual delas recebe a
 * passagem. Uma pessoa pode ter várias visitas vivas (o 202 pré-autorizou o
 * João para hoje; a portaria liberou o João no 101): a escolha era "a primeira
 * que o banco devolver" (`.find` sem `orderBy`), então a entrada caía na
 * visita de outra unidade e o aviso "chegou" ia para o morador errado.
 */

const VINTE_QUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

export interface ContextoVisita {
  agora: number;
  /** 'dom'…'sab' no horário de Brasília (o relógio do aparelho). */
  diaSemana: string;
  /** Visitas com vaga vigente cedida pelo morador: a vaga tem janela própria. */
  comVagaVigente?: ReadonlySet<number>;
}

const ms = (d: Date | string | null | undefined): number | null => (d ? new Date(d).getTime() : null);

export function diaSemanaBrt(agora: number): string {
  const brt = new Date(new Date(agora).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return DIAS_SEMANA[brt.getDay()];
}

export function contextoVisita(agora = Date.now(), comVagaVigente?: ReadonlySet<number>): ContextoVisita {
  return { agora, diaSemana: diaSemanaBrt(agora), comVagaVigente };
}

/** Entrou e não saiu, há menos de 24 h (proteção contra estado órfão). */
export function dentroDoCondominio(v: any, agora: number): boolean {
  return !!v?.data_entrada && !v.data_saida && agora - new Date(v.data_entrada).getTime() < VINTE_QUATRO_HORAS_MS;
}

/** Prazo curto da autorização remota, salvo quando o morador cedeu vaga (janela própria). */
export function prazoRemotoEfetivoMs(v: any, ctx: Pick<ContextoVisita, 'comVagaVigente'>): number | null {
  if (ctx.comVagaVigente?.has(v.id)) return null;
  return prazoAutorizacaoRemotaMs(v);
}

/** Libera ENTRADA agora: liberada, sem bloqueio, na janela (com tolerância e prazo remoto) e no dia. */
export function vigenteParaEntrada(v: any, ctx: ContextoVisita): boolean {
  if (!v || v.bloqueado === 1 || v.liberado !== 1) return false;
  const inicio = ms(v.data_hora_inicio);
  const termino = ms(v.data_hora_termino);
  const prazo = prazoRemotoEfetivoMs(v, ctx);
  if (inicio !== null && ctx.agora < inicio - TOLERANCIA_JANELA_MS) return false;
  if (termino !== null && ctx.agora > termino + TOLERANCIA_JANELA_MS) return false;
  if (prazo !== null && ctx.agora > prazo) return false;
  const dias: string[] = v.dias_semana
    ? String(v.dias_semana).split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
    : [];
  return dias.length === 0 || dias.includes(ctx.diaSemana);
}

/** Autoriza a pessoa no terminal: libera a entrada, ou ela está dentro (precisa sair). */
export function visitaAtiva(v: any, ctx: ContextoVisita): boolean {
  if (!v || v.bloqueado === 1 || v.liberado !== 1) return false;
  return vigenteParaEntrada(v, ctx) || dentroDoCondominio(v, ctx.agora);
}

/** Quando a visita foi liberada/criada por último (o `Liberar` regrava a linha: updated_at). */
function liberadaEm(v: any): number {
  return Math.max(ms(v.updated_at) ?? 0, ms(v.created_at) ?? 0, ms(v.auth_respondido_em) ?? 0);
}

const porLiberacaoDesc = (a: any, b: any) => liberadaEm(b) - liberadaEm(a) || Number(b.id) - Number(a.id);
const porEntradaDesc = (a: any, b: any) =>
  (ms(b.data_entrada) ?? 0) - (ms(a.data_entrada) ?? 0) || Number(b.id) - Number(a.id);

/** Visitas que liberam a ENTRADA agora, da liberação mais recente para a mais antiga. */
export function vigentesParaEntrada(visitas: any[], ctx: ContextoVisita): any[] {
  return (visitas ?? []).filter((v) => vigenteParaEntrada(v, ctx)).sort(porLiberacaoDesc);
}

/**
 * A visita que recebe a passagem, em ordem determinística:
 *  - SAÍDA (e sincronização do aparelho, que precisa deixar sair quem está
 *    dentro): a visita em que a pessoa está dentro (entrada mais recente);
 *  - ENTRADA: a visita liberada e vigente liberada/criada mais recentemente;
 *  - desempate sempre pelo id mais alto.
 * Sem visita ativa: null (a pessoa não passa).
 */
export function escolherVisita(visitas: any[], ctx: ContextoVisita, evento?: string | null): any | null {
  const ativas = (visitas ?? []).filter((v) => visitaAtiva(v, ctx));
  const dentro = ativas.filter((v) => dentroDoCondominio(v, ctx.agora)).sort(porEntradaDesc);
  const prontas = ativas
    .filter((v) => vigenteParaEntrada(v, ctx) && !dentroDoCondominio(v, ctx.agora))
    .sort(porLiberacaoDesc);
  if (evento === 'entrada') return prontas[0] ?? dentro[0] ?? null;
  return dentro[0] ?? prontas[0] ?? null;
}
