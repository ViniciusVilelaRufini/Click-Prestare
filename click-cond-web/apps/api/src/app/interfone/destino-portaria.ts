/**
 * Destino da chamada da portaria: porteiro local ou central humana.
 * Funções puras (sem Nest/Prisma) para testar a regra isolada.
 */
export type DestinoPortaria = 'local' | 'central';

export interface FaixaAgenda {
  dia_semana: number; // 0 = domingo
  inicio: string; // HH:MM
  fim: string; // HH:MM ("24:00" = fim do dia)
  destino: DestinoPortaria;
}

export interface MomentoBrasilia {
  diaSemana: number;
  minutos: number;
}

/** Brasília é UTC−3 o ano todo (sem horário de verão desde 2019). */
const FUSO_BRASILIA_MS = -3 * 3_600_000;

/**
 * Dia da semana e minutos desde 00:00 no horário de Brasília. Conta fixa (UTC−3), sem os nomes do
 * Intl/ICU: com small-icu o pt-BR cai para o inglês ("Sun") e o dia virava sempre domingo.
 */
export function agoraEmBrasilia(agora: Date): MomentoBrasilia {
  const local = new Date(agora.getTime() + FUSO_BRASILIA_MS);
  return {
    diaSemana: local.getUTCDay(),
    minutos: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function paraMinutos(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24 && min === 0) return 1440;
  if (h > 23) return null;
  return h * 60 + min;
}

/**
 * Sem contrato → local. Faixa central → central. Fora disso, sem porteiro online
 * a central assume (salvaguarda); com porteiro, local.
 */
export function decidirDestino(
  centralContratada: boolean,
  faixas: FaixaAgenda[],
  momento: MomentoBrasilia,
  porteiroOnline: boolean,
): DestinoPortaria {
  if (!centralContratada) return 'local';
  const faixa = faixas.find((x) => {
    const i = paraMinutos(x.inicio);
    const fim = paraMinutos(x.fim);
    return x.dia_semana === momento.diaSemana && i !== null && fim !== null && i <= momento.minutos && momento.minutos < fim;
  });
  if (faixa?.destino === 'central') return 'central';
  if (!porteiroOnline) return 'central';
  return 'local';
}

/** Mensagem de erro em pt-BR, ou null se a agenda é válida. */
export function validarAgenda(faixas: FaixaAgenda[]): string | null {
  const porDia = new Map<number, Array<[number, number]>>();
  for (const x of faixas) {
    if (!Number.isInteger(x.dia_semana) || x.dia_semana < 0 || x.dia_semana > 6) return 'Dia da semana inválido.';
    if (x.destino !== 'local' && x.destino !== 'central') return 'Destino inválido: use local ou central.';
    const i = paraMinutos(x.inicio);
    const f = paraMinutos(x.fim);
    if (i === null || f === null || i === 1440) return `Horário inválido (${x.inicio}–${x.fim}): use HH:MM.`;
    if (i >= f) return `O início (${x.inicio}) deve ser anterior ao fim (${x.fim}).`;
    const lista = porDia.get(x.dia_semana) ?? [];
    if (lista.some(([a, b]) => i < b && a < f)) return `Faixas sobrepostas no mesmo dia (${x.inicio}–${x.fim}).`;
    lista.push([i, f]);
    porDia.set(x.dia_semana, lista);
  }
  return null;
}
