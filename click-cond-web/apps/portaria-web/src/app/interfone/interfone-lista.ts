import type { ChamadaHoje, ResultadoChamada, TipoChamada } from './interfone.api';

const TIPO: Record<TipoChamada, string> = {
  facial_unidade: 'Portão → unidade',
  facial_portaria: 'Portão → portaria',
  portaria_unidade: 'Portaria → unidade',
  unidade_portaria: 'Unidade → portaria',
};

/** Nome da unidade da chamada; a do visitante que discou a portaria não tem unidade. */
export function rotuloUnidade(c: Pick<ChamadaHoje, 'unidade'>): string {
  return c.unidade?.trim() ? c.unidade : 'Portaria';
}

const RESULTADO: Record<ResultadoChamada, string> = {
  atendida_morador: 'Atendida pelo morador',
  atendida_portaria: 'Atendida pela portaria',
  nao_atendida: 'Não atendida',
  recusada: 'Recusada',
  falha: 'Falha',
  cancelada: 'Desligou antes',
};

export function rotuloTipo(c: Pick<ChamadaHoje, 'tipo'>): string {
  return TIPO[c.tipo] ?? c.tipo;
}

const RESULTADO_CURTO: Record<ResultadoChamada, string> = {
  atendida_morador: 'Atendida',
  atendida_portaria: 'Portaria atendeu',
  nao_atendida: 'Não atendida',
  recusada: 'Recusada',
  falha: 'Falha',
  cancelada: 'Desligou',
};

/** Etiqueta da linha da lista (curta: quem atendeu vai no texto ao lado). */
export function rotuloCurto(c: Pick<ChamadaHoje, 'resultado'>): string {
  return c.resultado ? (RESULTADO_CURTO[c.resultado] ?? c.resultado) : 'Em andamento';
}

export function rotuloResultado(c: Pick<ChamadaHoje, 'resultado'>): string {
  return c.resultado ? (RESULTADO[c.resultado] ?? c.resultado) : 'Em andamento';
}

/** Dias anteriores que o porteiro pode ver (o mesmo limite do histórico do app do morador e da API). */
export const DIAS_ANTERIORES = 30;

export type GrupoResultado = 'atendida' | 'sem_resposta' | 'falha' | 'andamento';
export type FiltroChamadas = 'todas' | 'atendidas' | 'sem_resposta' | 'falhas' | 'portoes';

export interface UnidadeFrequente {
  id_apartamento: number;
  unidade: string;
  total: number;
}

/** Resultado da chamada em quatro grupos (cor da etiqueta e filtros). */
export function grupo(c: Pick<ChamadaHoje, 'resultado'>): GrupoResultado {
  switch (c.resultado) {
    case 'atendida_morador':
    case 'atendida_portaria':
      return 'atendida';
    case 'nao_atendida':
    case 'recusada':
    case 'cancelada':
      return 'sem_resposta';
    case 'falha':
      return 'falha';
    default:
      return 'andamento';
  }
}

const DO_FILTRO: Record<Exclude<FiltroChamadas, 'todas'>, (c: ChamadaHoje) => boolean> = {
  atendidas: (c) => grupo(c) === 'atendida',
  sem_resposta: (c) => grupo(c) === 'sem_resposta',
  falhas: (c) => grupo(c) === 'falha',
  portoes: (c) => c.porta_aberta,
};

export function filtrar(lista: ChamadaHoje[], f: FiltroChamadas): ChamadaHoje[] {
  return f === 'todas' ? lista : lista.filter(DO_FILTRO[f]);
}

export function contar(lista: ChamadaHoje[]): Record<FiltroChamadas, number> {
  const n: Record<FiltroChamadas, number> = { todas: lista.length, atendidas: 0, sem_resposta: 0, falhas: 0, portoes: 0 };
  for (const c of lista) {
    for (const f of Object.keys(DO_FILTRO) as (keyof typeof DO_FILTRO)[]) if (DO_FILTRO[f](c)) n[f]++;
  }
  return n;
}

/** Unidades mais chamadas (lista mais recente primeiro: no empate fica a chamada mais recente). */
export function frequentes(lista: ChamadaHoje[], max = 5): UnidadeFrequente[] {
  const porApto = new Map<number, UnidadeFrequente>();
  for (const c of lista) {
    if (c.id_apartamento == null) continue;
    const u = porApto.get(c.id_apartamento);
    if (u) u.total++;
    else porApto.set(c.id_apartamento, { id_apartamento: c.id_apartamento, unidade: c.unidade, total: 1 });
  }
  // sort é estável: no empate mantém a ordem de inserção (a da chamada mais recente).
  return [...porApto.values()].sort((a, b) => b.total - a.total).slice(0, max);
}

const DIA_BRASILIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** AAAA-MM-DD no calendário de Brasília (o mesmo da API), qualquer que seja o fuso do navegador. */
export function dataBrasilia(d: Date): string {
  return DIA_BRASILIA.format(d);
}

/** Limites do seletor de data: hoje (Brasília) até DIAS_ANTERIORES atrás. */
export function limitesData(agora: Date): { min: string; max: string } {
  const max = dataBrasilia(agora);
  const [a, m, d] = max.split('-').map(Number);
  const min = new Date(Date.UTC(a, m - 1, d - DIAS_ANTERIORES)).toISOString().slice(0, 10);
  return { min, max };
}
