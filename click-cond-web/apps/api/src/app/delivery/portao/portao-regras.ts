import { createHash, randomBytes } from 'crypto';

/**
 * Regras puras do pedido de portão (autoatendimento do entregador).
 * Spec: docs/superpowers/specs/2026-11-13-entregador-autoatendimento-portao-design.md
 */

/** Pedido sem resposta do morador expira (o próximo entregador volta a ser aceito). */
export const PEDIDO_EXPIRA_MS = 5 * 60_000;
/** A página mostra "Sem resposta" (só texto; o pedido continua valendo). */
export const SEM_RESPOSTA_MS = 60_000;
/** Depois de o morador liberar, o portão pode abrir até este prazo. */
export const JANELA_ABERTURA_MS = 3 * 60_000;
/** A página consultou há no máximo isto: o entregador está lá, abre na hora. */
export const PRESENCA_MS = 10_000;
/** "Abrir para sair" vale até este prazo depois da entrada. */
export const SAIDA_MS = 30 * 60_000;
/** Atendimento do autoatendimento sem resposta é cancelado pela rotina. */
export const CANCELA_SEM_RESPOSTA_MS = 2 * 3_600_000;
/** Autorizado sem abertura, ou "vou buscar", sem porteiro: a rotina conclui. */
export const CONCLUI_SEM_PORTEIRO_MS = 2 * 3_600_000;
export const FOTO_RETENCAO_DIAS = 90;
export const MAX_PEDIDOS_PORTAO_10MIN = 20;
/** Teto de pedidos para a mesma unidade em 1 hora. */
export const MAX_PEDIDOS_UNIDADE_HORA = 6;
/** Depois de a unidade recusar (ou "vou buscar"), pedidos novos para ela são recusados por este tempo. */
export const TREGUA_UNIDADE_MS = 10 * 60_000;
/** Teto da selfie em base64 (a página reduz a 800 px, JPEG 0.8). */
export const MAX_FOTO_BYTES = 2 * 1024 * 1024;
export const FOTO_MIME = /^data:image\/(jpeg|jpg|png|webp);base64,/i;

export type StatusPedido = 'pendente' | 'liberado' | 'vou_buscar' | 'recusado' | 'expirado';
export type SituacaoPagina =
  | 'aguardando'
  | 'sem_resposta'
  | 'liberado'
  | 'liberado_portaria'
  | 'aberto'
  | 'vou_buscar'
  | 'recusado'
  | 'expirado';

export interface PedidoRegra {
  status: StatusPedido;
  criado_em: Date;
  expira_em: Date;
  liberado_ate: Date | null;
  aberto_em: Date | null;
  saida_aberta_em: Date | null;
}

export interface EstadoPedido {
  situacao: SituacaoPagina;
  pode_abrir: boolean;
  pode_sair: boolean;
  liberado_ate: string | null;
}

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Brasília fixa em -03:00, como `DeliveryService.periodo` (sem horário de verão desde 2019). */
const BRT_MS = 3 * 3_600_000;

export function horarioValido(v: unknown): v is string {
  return typeof v === 'string' && HORARIO.test(v);
}

function minutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * `HH:MM` no fuso de Brasília; início inclusivo, fim exclusivo. Sem horário
 * (ou com início igual ao fim) vale o dia inteiro. Início depois do fim
 * atravessa a meia-noite (22:00–06:00).
 */
export function dentroDoHorario(inicio: string | null, fim: string | null, agora: Date): boolean {
  if (!horarioValido(inicio) || !horarioValido(fim)) return true;
  const ini = minutos(inicio);
  const f = minutos(fim);
  if (ini === f) return true;
  const local = new Date(agora.getTime() - BRT_MS);
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  return ini < f ? m >= ini && m < f : m >= ini || m < f;
}

const t = (d: Date | null) => (d ? new Date(d).getTime() : null);

/** O que a página do entregador mostra e pode fazer agora. */
export function estadoDoPedido(p: PedidoRegra, agora: Date): EstadoPedido {
  const ms = agora.getTime();
  const fim = (situacao: SituacaoPagina, extra: Partial<EstadoPedido> = {}): EstadoPedido => ({
    situacao,
    pode_abrir: false,
    pode_sair: false,
    liberado_ate: null,
    ...extra,
  });
  switch (p.status) {
    case 'pendente':
      if (ms >= t(p.expira_em)!) return fim('expirado');
      if (ms - t(p.criado_em)! >= SEM_RESPOSTA_MS) return fim('sem_resposta');
      return fim('aguardando');
    case 'liberado': {
      const aberto = t(p.aberto_em);
      if (aberto !== null) {
        return fim('aberto', { pode_sair: !p.saida_aberta_em && ms <= aberto + SAIDA_MS });
      }
      const ate = t(p.liberado_ate);
      if (ate === null) return fim('liberado_portaria');
      if (ms <= ate) return fim('liberado', { pode_abrir: true, liberado_ate: new Date(ate).toISOString() });
      return fim('expirado');
    }
    case 'vou_buscar':
    case 'recusado':
    case 'expirado':
      return fim(p.status);
    default:
      return fim('expirado');
  }
}

/** Token do pedido (fica só na página do entregador). */
export function novoToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
