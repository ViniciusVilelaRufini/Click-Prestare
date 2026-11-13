import { DeliveryStatus } from '../delivery.model';

export const STATUS_CARDS: readonly DeliveryStatus[] = ['AGENDADA', 'CHEGOU', 'AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA'];
export const STATUS_FILTRO: readonly DeliveryStatus[] = STATUS_CARDS;
export const STATUS_TERMINAIS: readonly DeliveryStatus[] = ['CONCLUIDA', 'CANCELADA', 'RECUSADA'];
export const ehTerminal = (s: DeliveryStatus): boolean => STATUS_TERMINAIS.includes(s);

export const PROXIMOS_STATUS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  AGENDADA: ['CHEGOU', 'CANCELADA'],
  CHEGOU: ['AGUARDANDO_AUTORIZACAO', 'AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AGUARDANDO_AUTORIZACAO: ['AUTORIZADA', 'RETIRADA_NA_PORTARIA', 'RECUSADA'],
  AUTORIZADA: ['CONCLUIDA'],
  RETIRADA_NA_PORTARIA: ['CONCLUIDA'],
  CONCLUIDA: [],
  CANCELADA: [],
  RECUSADA: [],
};

export type TomStatus = 'slate' | 'amber' | 'sky' | 'emerald' | 'violet' | 'red';

const INFO: Record<DeliveryStatus, { rotulo: string; tom: TomStatus; verbo: string }> = {
  AGENDADA: { rotulo: 'Agendada', tom: 'slate', verbo: 'Agendar' },
  CHEGOU: { rotulo: 'Chegou', tom: 'amber', verbo: 'Registrar chegada' },
  AGUARDANDO_AUTORIZACAO: { rotulo: 'Aguardando autorização', tom: 'sky', verbo: 'Pedir autorização ao morador' },
  AUTORIZADA: { rotulo: 'Autorizada', tom: 'emerald', verbo: 'Autorizar subida' },
  RETIRADA_NA_PORTARIA: { rotulo: 'Na portaria – aguardando retirada', tom: 'violet', verbo: 'Deixar na portaria' },
  CONCLUIDA: { rotulo: 'Concluída', tom: 'emerald', verbo: 'Concluir' },
  CANCELADA: { rotulo: 'Cancelada', tom: 'slate', verbo: 'Cancelar aviso' },
  RECUSADA: { rotulo: 'Recusada', tom: 'red', verbo: 'Recusar' },
};

// Strings completas para o Tailwind enxergar as classes no build.
export const CLASSES_TOM: Record<TomStatus, { texto: string; fundo: string; borda: string; ponto: string; anel: string }> = {
  slate: { texto: 'text-slate-600 dark:text-slate-300', fundo: 'bg-slate-500/10', borda: 'border-slate-500/30', ponto: 'bg-slate-400', anel: 'ring-slate-400/60' },
  amber: { texto: 'text-amber-700 dark:text-amber-300', fundo: 'bg-amber-500/10', borda: 'border-amber-500/30', ponto: 'bg-amber-500', anel: 'ring-amber-500/60' },
  sky: { texto: 'text-sky-700 dark:text-sky-300', fundo: 'bg-sky-500/10', borda: 'border-sky-500/30', ponto: 'bg-sky-500', anel: 'ring-sky-500/60' },
  emerald: { texto: 'text-emerald-700 dark:text-emerald-300', fundo: 'bg-emerald-500/10', borda: 'border-emerald-500/30', ponto: 'bg-emerald-500', anel: 'ring-emerald-500/60' },
  violet: { texto: 'text-violet-700 dark:text-violet-300', fundo: 'bg-violet-500/10', borda: 'border-violet-500/30', ponto: 'bg-violet-500', anel: 'ring-violet-500/60' },
  red: { texto: 'text-red-700 dark:text-red-300', fundo: 'bg-red-500/10', borda: 'border-red-500/30', ponto: 'bg-red-500', anel: 'ring-red-500/60' },
};

export const rotuloStatus = (s: DeliveryStatus): string => INFO[s]?.rotulo ?? s;
export const tomStatus = (s: DeliveryStatus): TomStatus => INFO[s]?.tom ?? 'slate';
export const verboAcao = (s: DeliveryStatus): string => INFO[s]?.verbo ?? rotuloStatus(s);
export const classesStatus = (s: DeliveryStatus) => CLASSES_TOM[tomStatus(s)];

/**
 * Recusar e cancelar pedem motivo e ficam fora dos botões comuns. Entrega na
 * portaria (o morador desce para buscar): a ação principal é deixar na
 * portaria, que não depende de identificar o entregador.
 */
export function organizarAcoes(proximos: readonly DeliveryStatus[], modo?: 'UNIDADE' | 'PORTARIA'): {
  primaria: DeliveryStatus | null;
  secundarias: DeliveryStatus[];
  recusar: boolean;
  cancelar: boolean;
} {
  const recusar = proximos.includes('RECUSADA');
  const cancelar = proximos.includes('CANCELADA');
  const restantes = proximos.filter((s) => s !== 'RECUSADA' && s !== 'CANCELADA');
  const preferida: DeliveryStatus = modo === 'PORTARIA' ? 'RETIRADA_NA_PORTARIA' : 'AUTORIZADA';
  const primaria: DeliveryStatus | null = restantes.includes(preferida) ? preferida : restantes[0] ?? null;
  return { primaria, secundarias: restantes.filter((s) => s !== primaria), recusar, cancelar };
}
