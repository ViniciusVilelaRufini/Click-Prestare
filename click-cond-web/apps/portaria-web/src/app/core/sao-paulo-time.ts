/**
 * Datas do console em America/Sao_Paulo, como o resto do sistema (a API le textos sem fuso como horario de
 * Brasilia). Sem isto, `getHours()` e `new Date(texto)` usavam o fuso do navegador e a janela saia deslocada
 * em PC fora de UTC-3.
 */
const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** "AAAA-MM-DDTHH:mm" no horario de Brasilia (formato do input datetime-local). */
export function formatarSaoPauloLocal(ms: number): string {
  const p: Record<string, string> = {};
  for (const x of FORMATO.formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}`;
}

/** Instante (ms) de um "AAAA-MM-DDTHH:mm" lido como horario de Brasilia (UTC-3, sem horario de verao). NaN se invalido. */
export function instanteSaoPaulo(local: string): number {
  if (!local) return NaN;
  const t = local.length === 16 ? `${local}:00` : local;
  return Date.parse(`${t}-03:00`);
}
