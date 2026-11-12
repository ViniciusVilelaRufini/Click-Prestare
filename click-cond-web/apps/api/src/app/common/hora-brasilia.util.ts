/**
 * O servidor roda em UTC. Regras de negócio que dependem do calendário do
 * condomínio (dia da semana permitido, datas exibidas ao porteiro) precisam do
 * horário de Brasília, senão entre 21:00 e 23:59 caem no dia seguinte.
 */
const FUSO = 'America/Sao_Paulo';
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

function partes(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

/** 'dom' … 'sab' no horário de Brasília. */
export function diaSemanaBrasilia(d: Date = new Date()): string {
  const wd = partes(d).weekday.toLowerCase().slice(0, 3);
  return DIAS[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(wd)];
}

/** "dd/MM/aaaa HH:mm" no horário de Brasília ('' para nulo). */
export function formatarDataHoraBrasilia(d: Date | null | undefined): string {
  if (!d) return '';
  const p = partes(new Date(d));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Hora (0–23) no horário de Brasília. */
export function horaBrasilia(d: Date = new Date()): number {
  return Number(partes(d).hour);
}

/**
 * Data de hoje em Brasília, à meia-noite UTC — o mesmo formato em que o Prisma
 * devolve colunas @db.Date (data_vencimento). Comparar com ela não marca como
 * vencida, à noite, a conta que vence no próprio dia.
 */
export function hojeBrasilia(d: Date = new Date()): Date {
  const p = partes(d);
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
}

/** Diferença (ms) entre o relógio de Brasília e o UTC no instante dado. */
function deslocamentoBrasiliaMs(instante: number): number {
  const p = partes(new Date(instante));
  const relogio = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute),
  );
  return relogio - Math.floor(instante / 60000) * 60000;
}

/** Instante UTC da meia-noite (Brasília) do dia civil y-m-d. */
function meiaNoiteBrasilia(ano: number, mes: number, dia: number): number {
  const utc = Date.UTC(ano, mes, dia);
  // Duas passadas cobrem a troca de offset (horário de verão) perto da meia-noite.
  let inst = utc - deslocamentoBrasiliaMs(utc);
  inst = utc - deslocamentoBrasiliaMs(inst);
  return inst;
}

/**
 * Início e fim do dia civil de Brasília que contém `d`, como INSTANTES —
 * para filtrar colunas DATETIME/timestamp (para colunas @db.Date use
 * `hojeBrasilia`). `inicio` é 00:00:00.000 e `fim` o ÚLTIMO milissegundo do
 * dia (23:59:59.999), ambos inclusivos: use `gte: inicio, lte: fim`.
 * O offset vem do Intl (America/Sao_Paulo), nada de -3 fixo no código.
 */
export function intervaloHojeBrasilia(d: Date = new Date()): { inicio: Date; fim: Date } {
  const p = partes(d);
  const ano = Number(p.year);
  const mes = Number(p.month) - 1;
  const dia = Number(p.day);
  return {
    inicio: new Date(meiaNoiteBrasilia(ano, mes, dia)),
    fim: new Date(meiaNoiteBrasilia(ano, mes, dia + 1) - 1),
  };
}
