import { AlertaCard, ConteudoCard, DELIVERY_MAX_SEG, FaseCard, epochSeg, rotuloUnidade } from './conteudo';

/**
 * Conteúdo do card ao vivo do delivery
 * (spec 2026-11-13-card-ao-vivo-delivery-design.md).
 *
 * Mesmo `ConteudoCard` da portaria (mesmas chaves do ContentState em Swift):
 * `nome` = estabelecimento, `tipo` = entregador, `horaResposta` = autorização
 * ou recusa, `horaEntrada` = entrega concluída.
 */

export type StatusDelivery =
  | 'AGENDADA'
  | 'CHEGOU'
  | 'AGUARDANDO_AUTORIZACAO'
  | 'AUTORIZADA'
  | 'RETIRADA_NA_PORTARIA'
  | 'CONCLUIDA'
  | 'CANCELADA'
  | 'RECUSADA';

export interface AtendimentoCard {
  id: number;
  status: StatusDelivery;
  estabelecimento: string | null;
  chegou_em: Date | null;
  autorizado_em: Date | null;
  recusado_em: Date | null;
  concluido_em: Date | null;
  motivo: string | null;
  bloco: string | null;
  apto: string | null;
  entregadorNome: string | null;
  entregadorPlataforma: string | null;
  /** Foto do entregador como está no cadastro (URL do bucket, chave ou data URL). */
  fotoEntregador: string | null;
}

/** null = sem card (AGENDADA); 'encerrar' = some na hora (CANCELADA). */
export function faseDoStatus(s: StatusDelivery): FaseCard | 'encerrar' | null {
  switch (s) {
    case 'CHEGOU':
      return 'chegou';
    case 'AGUARDANDO_AUTORIZACAO':
      return 'aguardando';
    case 'AUTORIZADA':
      return 'autorizado';
    case 'RETIRADA_NA_PORTARIA':
      return 'retirar';
    case 'CONCLUIDA':
      return 'entregue';
    case 'RECUSADA':
      return 'recusado';
    case 'CANCELADA':
      return 'encerrar';
    default:
      return null;
  }
}

const seg = (d: Date | null) => (d ? epochSeg(new Date(d)) : null);

export function conteudoDelivery(
  a: AtendimentoCard,
  fase: FaseCard,
  extras: { voceRespondeu: boolean; foto?: string | null },
  agoraSeg: number,
): ConteudoCard {
  const chegouEm = seg(a.chegou_em) ?? agoraSeg;
  const entregador = [a.entregadorNome?.trim(), a.entregadorPlataforma?.trim()].filter(Boolean).join(' · ');
  const respondeu = fase === 'autorizado' || fase === 'recusado';
  const c: ConteudoCard = {
    fase,
    nome: a.estabelecimento?.trim() || 'Delivery',
    tipo: entregador || 'Entregador',
    unidade: rotuloUnidade(a.bloco, a.apto),
    chegouEm,
    expiraEm: chegouEm + DELIVERY_MAX_SEG,
    respondidoPor: null,
    voceRespondeu: respondeu && extras.voceRespondeu,
    pelaPortaria: respondeu && !extras.voceRespondeu,
    horaResposta: fase === 'recusado' ? seg(a.recusado_em) : seg(a.autorizado_em),
    horaEntrada: seg(a.concluido_em),
    ...(fase === 'recusado' ? { motivo: a.motivo?.trim() || null } : {}),
  };
  if (extras.foto) c.foto = extras.foto;
  return c;
}

/** Aviso que toca: chegada, pedido de autorização e "retire na portaria". */
export function alertaDelivery(fase: FaseCard, c: Pick<ConteudoCard, 'nome'>): AlertaCard | null {
  switch (fase) {
    case 'chegou':
      return { titulo: 'Delivery na portaria', corpo: `${c.nome} chegou. Acompanhe pelo card.` };
    case 'aguardando':
      return { titulo: 'Autorize a entrega', corpo: `A portaria aguarda sua autorização para ${c.nome}.` };
    case 'retirar':
      return { titulo: 'Retire na portaria', corpo: `Sua entrega de ${c.nome} está na portaria.` };
    default:
      return null;
  }
}

/** Textos da notificação de hoje (DeliveryService.notificarMorador). */
export function mensagemDelivery(status: StatusDelivery, motivo?: string | null): string {
  const mensagens: Partial<Record<StatusDelivery, string>> = {
    CHEGOU: 'Seu entregador chegou à portaria.',
    AGUARDANDO_AUTORIZACAO: 'A portaria aguarda sua autorização para a entrega.',
    AUTORIZADA: 'Sua entrega foi autorizada.',
    CONCLUIDA: 'Sua entrega foi concluída.',
    RECUSADA: `Sua entrega foi recusada pela portaria.${motivo?.trim() ? ` Motivo: ${motivo.trim()}` : ''}`,
    RETIRADA_NA_PORTARIA: 'Sua entrega ficou na portaria. Retire quando puder.',
  };
  return mensagens[status] ?? 'Atualização no seu atendimento.';
}

/** Segundos na tela depois do fim; null = card continua aberto. */
export function dismissalDelivery(fase: FaseCard): number | null {
  if (fase === 'entregue') return 300;
  if (fase === 'recusado') return 120;
  return null;
}
