export type DeliveryStatus =
  | 'AGENDADA'
  | 'CHEGOU'
  | 'AGUARDANDO_AUTORIZACAO'
  | 'AUTORIZADA'
  | 'RETIRADA_NA_PORTARIA'
  | 'CONCLUIDA'
  | 'CANCELADA'
  | 'RECUSADA';

export type EntregadorStatus = 'ATIVO' | 'BLOQUEADO';

export interface DeliveryVeiculo {
  id?: number;
  tipo?: string | null;
  placa?: string | null;
  modelo?: string | null;
  cor?: string | null;
}

export interface DeliveryEntregador {
  id: number;
  nome: string;
  telefone?: string | null;
  documento?: string | null;
  plataforma?: string | null;
  status: EntregadorStatus;
  motivo_bloqueio?: string | null;
  veiculos: DeliveryVeiculo[];
}

export interface DeliveryEvento {
  id: number;
  status_anterior?: DeliveryStatus | null;
  status_novo: DeliveryStatus;
  autor_nome?: string | null;
  /** Calculado pela API; opcional (eventos antigos/respostas sem o campo). */
  autor_papel?: 'morador' | 'portaria' | 'sistema' | 'autoatendimento' | null;
  mensagem?: string | null;
  created_at: string;
}

/**
 * Pedido de portão mais recente do atendimento (autoatendimento do
 * entregador pelo QR). `foto` é link assinado e temporário do bucket privado.
 */
export interface DeliveryPedidoPortao {
  nome: string;
  plataforma?: string | null;
  foto?: string | null;
  /** pendente | liberado | vou_buscar | recusado | expirado */
  status: string;
  /** Nome do aparelho do QR lido. */
  portao: string;
  aberto_em?: string | null;
  saida_aberta_em?: string | null;
}

/** Configuração do autoatendimento de entregas do condomínio. */
export interface ConfigAutoatendimento {
  habilitado: boolean;
  /** HH:MM; os dois nulos = dia inteiro. */
  inicio: string | null;
  fim: string | null;
}

export interface DeliveryAtendimento {
  id: number;
  status: DeliveryStatus;
  estabelecimento?: string | null;
  nome_entregador?: string | null;
  telefone_entregador?: string | null;
  modo_entrega: 'UNIDADE' | 'PORTARIA';
  observacao_morador?: string | null;
  /** Horário previsto informado pelo morador no aviso. */
  previsao_em?: string | null;
  motivo?: string | null;
  apartamento: { id: number; bloco?: string | null; apto: string };
  entregador?: DeliveryEntregador | null;
  eventos: DeliveryEvento[];
  created_at: string;
  chegou_em?: string | null;
  autorizado_em?: string | null;
  concluido_em?: string | null;
  cancelado_em?: string | null;
  recusado_em?: string | null;
  updated_at?: string | null;
  /** Só na resposta do "Pedir autorização": quantos da unidade podem receber o pedido. */
  avisados?: number;
  /** De onde veio o atendimento: a portaria/o aviso do morador, ou o QR do portão. */
  origem?: 'portaria' | 'autoatendimento';
  pedido_portao?: DeliveryPedidoPortao | null;
}

export interface CriarEntregadorDelivery {
  nome: string;
  telefone?: string;
  documento?: string;
  plataforma?: string;
  veiculo?: Omit<DeliveryVeiculo, 'id'>;
}

export interface AtualizarEntregadorDelivery extends Partial<Omit<CriarEntregadorDelivery, 'veiculo'>> {
  status?: EntregadorStatus;
  motivo_bloqueio?: string;
  veiculo?: Omit<DeliveryVeiculo, 'id'> | null;
}

export interface DeliveryResumo {
  ativos: Partial<Record<DeliveryStatus, number>>;
  periodo: { de: string; ate: string; CONCLUIDA: number; CANCELADA: number; RECUSADA: number; total: number };
  tempo_medio_atendimento_min: number | null;
}
