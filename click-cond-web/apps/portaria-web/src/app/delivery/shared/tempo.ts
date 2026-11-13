import { DeliveryAtendimento } from '../delivery.model';

export type PeriodoHistorico = 'hoje' | '7d' | '30d';
const LIMITE_ATENCAO_MIN = 10;
/** Entregador autorizado que a portaria não concluiu (subiu e não voltou?). */
const LIMITE_AUTORIZADA_MIN = 15;
/** Entrega deixada na portaria que ninguém buscou. */
const LIMITE_NA_PORTARIA_MIN = 30;
const pad = (n: number) => String(n).padStart(2, '0');

/** Quando a etapa atual começou: autorização, chegada à portaria (deixada lá) ou chegada do entregador. */
export function inicioEspera(a: DeliveryAtendimento): string {
  if (a.status === 'AUTORIZADA' && a.autorizado_em) return a.autorizado_em;
  if (a.status === 'RETIRADA_NA_PORTARIA') {
    const evento = [...(a.eventos ?? [])].reverse().find((e) => e.status_novo === 'RETIRADA_NA_PORTARIA');
    if (evento?.created_at) return evento.created_at;
  }
  if (a.status === 'RECUSADA' && a.recusado_em) return a.recusado_em;
  if (a.status === 'CANCELADA' && a.cancelado_em) return a.cancelado_em;
  return a.chegou_em || a.created_at;
}

export function minutosDesde(iso: string, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 60_000));
}

export function textoEspera(min: number): string {
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h ${pad(min % 60)} min`;
}

export function emAtencao(a: DeliveryAtendimento, agora: Date): boolean {
  const limite = ['CHEGOU', 'AGUARDANDO_AUTORIZACAO'].includes(a.status)
    ? LIMITE_ATENCAO_MIN
    : a.status === 'AUTORIZADA'
      ? LIMITE_AUTORIZADA_MIN
      : a.status === 'RETIRADA_NA_PORTARIA'
        ? LIMITE_NA_PORTARIA_MIN
        : null;
  return limite !== null && minutosDesde(inicioEspera(a), agora) > limite;
}

export function textoDuracao(min: number | null): string {
  if (min === null || min === undefined) return '—';
  const total = Math.round(min);
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${pad(total % 60)} min`;
}

const dataLocal = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function intervaloPeriodo(p: PeriodoHistorico, agora: Date): { de: string; ate: string } {
  const dias = p === 'hoje' ? 0 : p === '7d' ? 6 : 29;
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - dias);
  return { de: dataLocal(inicio), ate: dataLocal(agora) };
}
