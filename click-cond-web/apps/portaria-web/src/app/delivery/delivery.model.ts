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
  mensagem?: string | null;
  created_at: string;
}

export interface DeliveryAtendimento {
  id: number;
  status: DeliveryStatus;
  estabelecimento?: string | null;
  nome_entregador?: string | null;
  telefone_entregador?: string | null;
  modo_entrega: 'UNIDADE' | 'PORTARIA';
  observacao_morador?: string | null;
  motivo?: string | null;
  apartamento: { id: number; bloco?: string | null; apto: string };
  entregador?: DeliveryEntregador | null;
  eventos: DeliveryEvento[];
  created_at: string;
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
