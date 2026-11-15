import { TOLERANCIA_JANELA_MS, ehAutorizacaoRemota, prazoAutorizacaoRemotaMs } from '../common/janela-visita';

/**
 * Qual visita da pessoa vale no terminal agora, e qual delas recebe a
 * passagem. Uma pessoa pode ter várias visitas vivas (o 202 pré-autorizou o
 * João para hoje; a portaria liberou o João no 101): a escolha era "a primeira
 * que o banco devolver" (`.find` sem `orderBy`), então a entrada caía na
 * visita de outra unidade e o aviso "chegou" ia para o morador errado.
 *
 * Princípio: na dúvida, fechar. Direitos de visitas diferentes nunca se
 * somam — o aparelho recebe janela, usos e categoria de UMA visita.
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

/**
 * Autorização remota já usada: vale para UMA entrada. Depois que a pessoa
 * entrou (terminal, console, "Autorizar e dar entrada" do app ou backlog), a
 * visita serve só para SAIR; nova entrada exige novo pedido ou a portaria
 * liberar. Vaga vigente cedida pelo morador tem janela própria.
 */
export function remotaConsumida(v: any, ctx: Pick<ContextoVisita, 'comVagaVigente'>): boolean {
  if (ctx.comVagaVigente?.has(v.id)) return false;
  return ehAutorizacaoRemota(v) && !!v.data_entrada;
}

function diaPermitido(v: any, ctx: ContextoVisita): boolean {
  const dias: string[] = v.dias_semana
    ? String(v.dias_semana).split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
    : [];
  return dias.length === 0 || dias.includes(ctx.diaSemana);
}

/**
 * Libera a entrada em `agora`, com `antecedenciaMs` antes do início: sem
 * bloqueio, liberada, autorização remota não consumida, até 15 min depois do
 * término (a tolerância só vale DEPOIS do fim), dentro do prazo remoto e no dia.
 */
function liberaEntrada(v: any, ctx: ContextoVisita, antecedenciaMs: number): boolean {
  if (!v || v.bloqueado === 1 || v.liberado !== 1) return false;
  if (remotaConsumida(v, ctx)) return false;
  const inicio = ms(v.data_hora_inicio);
  const termino = ms(v.data_hora_termino);
  const prazo = prazoRemotoEfetivoMs(v, ctx);
  if (inicio !== null && ctx.agora < inicio - antecedenciaMs) return false;
  if (termino !== null && ctx.agora > termino + TOLERANCIA_JANELA_MS) return false;
  if (prazo !== null && ctx.agora > prazo) return false;
  return diaPermitido(v, ctx);
}

/** Libera a ENTRADA agora — a partir do início EXATO, como o portão confere. */
export function vigenteParaEntrada(v: any, ctx: ContextoVisita): boolean {
  return liberaEntrada(v, ctx, 0);
}

/**
 * Pode estar no aparelho de entrada agora: como `vigenteParaEntrada`, mas até
 * 15 min antes do início (pré-enrolamento). Quem barra antes da hora é o
 * próprio aparelho, pelo ValidFrom = início.
 */
export function liberaNoTerminal(v: any, ctx: ContextoVisita): boolean {
  return liberaEntrada(v, ctx, TOLERANCIA_JANELA_MS);
}

/** Autoriza a pessoa no terminal: libera a entrada (ou está para liberar), ou ela está dentro (precisa sair). */
export function visitaAtiva(v: any, ctx: ContextoVisita): boolean {
  if (!v || v.bloqueado === 1 || v.liberado !== 1) return false;
  return liberaNoTerminal(v, ctx) || dentroDoCondominio(v, ctx.agora);
}

/** Quando a visita foi liberada/criada por último (o `Liberar` regrava a linha: updated_at). */
function liberadaEm(v: any): number {
  return Math.max(ms(v.updated_at) ?? 0, ms(v.created_at) ?? 0, ms(v.auth_respondido_em) ?? 0);
}

const porLiberacaoDesc = (a: any, b: any) => liberadaEm(b) - liberadaEm(a) || Number(b.id) - Number(a.id);
const porEntradaDesc = (a: any, b: any) =>
  (ms(b.data_entrada) ?? 0) - (ms(a.data_entrada) ?? 0) || Number(b.id) - Number(a.id);
const porInicioAsc = (a: any, b: any) =>
  (ms(a.data_hora_inicio) ?? 0) - (ms(b.data_hora_inicio) ?? 0) || porLiberacaoDesc(a, b);

/** Visitas que liberam a ENTRADA agora (início exato), da liberação mais recente para a mais antiga. */
export function vigentesParaEntrada(visitas: any[], ctx: ContextoVisita): any[] {
  return (visitas ?? []).filter((v) => vigenteParaEntrada(v, ctx)).sort(porLiberacaoDesc);
}

/**
 * A visita que recebe a passagem e dita o que vai para o aparelho, em ordem
 * determinística:
 *  - SAÍDA (e sincronização do aparelho, que precisa deixar sair quem está
 *    dentro): a visita em que a pessoa está dentro (entrada mais recente);
 *  - ENTRADA: a visita já iniciada e vigente liberada/criada mais
 *    recentemente. Visita que ainda não começou nunca vence uma vigente;
 *  - desempate sempre pelo id mais alto.
 * Sem visita ativa: null (a pessoa não passa).
 */
export function escolherVisita(visitas: any[], ctx: ContextoVisita, evento?: string | null): any | null {
  const ativas = (visitas ?? []).filter((v) => visitaAtiva(v, ctx));
  const dentro = ativas.filter((v) => dentroDoCondominio(v, ctx.agora)).sort(porEntradaDesc);
  const fora = ativas.filter((v) => !dentroDoCondominio(v, ctx.agora));
  const iniciadas = fora.filter((v) => vigenteParaEntrada(v, ctx)).sort(porLiberacaoDesc);
  // Começa nos próximos 15 min: só quando nenhuma outra vale (o aparelho e o
  // portão barram até o início).
  const aComecar = fora.filter((v) => !vigenteParaEntrada(v, ctx)).sort(porInicioAsc);
  if (evento === 'entrada') return iniciadas[0] ?? dentro[0] ?? aComecar[0] ?? null;
  return dentro[0] ?? iniciadas[0] ?? aComecar[0] ?? null;
}
