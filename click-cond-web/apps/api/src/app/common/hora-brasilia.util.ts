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
