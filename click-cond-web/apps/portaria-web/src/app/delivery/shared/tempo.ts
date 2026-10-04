import { DeliveryAtendimento } from '../delivery.model';

export type PeriodoHistorico = 'hoje' | '7d' | '30d';
const LIMITE_ATENCAO_MIN = 10;
const pad = (n: number) => String(n).padStart(2, '0');

export const inicioEspera = (a: DeliveryAtendimento): string => a.chegou_em || a.created_at;

export function minutosDesde(iso: string, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 60_000));
}

export function textoEspera(min: number): string {
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h ${pad(min % 60)} min`;
}

export function emAtencao(a: DeliveryAtendimento, agora: Date): boolean {
  return ['CHEGOU', 'AGUARDANDO_AUTORIZACAO'].includes(a.status)
    && minutosDesde(inicioEspera(a), agora) > LIMITE_ATENCAO_MIN;
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
