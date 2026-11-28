import type { ChamadaHoje } from './interfone.api';

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

/** AAAA-MM-DD no calendário do navegador. */
export function dataLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Limites do seletor de data: hoje até DIAS_ANTERIORES atrás. */
export function limitesData(hoje: Date): { min: string; max: string } {
  const min = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - DIAS_ANTERIORES);
  return { min: dataLocal(min), max: dataLocal(hoje) };
}
