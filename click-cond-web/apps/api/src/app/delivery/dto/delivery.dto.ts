export class CriarDeliveryDto {
  id_condominio!: number;
  id_apartamento!: number;
  estabelecimento?: string;
  previsao_em?: string;
  observacao_morador?: string;
  modo_entrega?: 'UNIDADE' | 'PORTARIA';
}

export class AtualizarStatusDeliveryDto {
  status!: string;
  motivo?: string;
  observacao?: string;
  id_entregador?: number;
}

export class CriarEntregadorDto {
  id_condominio!: number;
  nome!: string;
  telefone?: string;
  documento?: string;
  plataforma?: string;
  foto?: string;
  veiculo?: { tipo?: string; placa?: string; modelo?: string; cor?: string };
}

export class AtualizarEntregadorDto {
  nome?: string;
  telefone?: string;
  documento?: string;
  plataforma?: string;
  foto?: string;
  status?: 'ATIVO' | 'BLOQUEADO';
  motivo_bloqueio?: string;
}
