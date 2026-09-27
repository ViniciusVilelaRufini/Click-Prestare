import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

const STATUS_DELIVERY = [
  'AGENDADA',
  'CHEGOU',
  'AGUARDANDO_AUTORIZACAO',
  'AUTORIZADA',
  'RETIRADA_NA_PORTARIA',
  'CONCLUIDA',
  'CANCELADA',
  'RECUSADA',
] as const;

export class VeiculoDeliveryDto {
  @IsOptional()
  @IsString()
  tipo?: string;

  @IsOptional()
  @IsString()
  placa?: string;

  @IsOptional()
  @IsString()
  modelo?: string;

  @IsOptional()
  @IsString()
  cor?: string;
}

export class CriarDeliveryDto {
  @Type(() => Number)
  @IsInt()
  id_condominio!: number;

  @Type(() => Number)
  @IsInt()
  id_apartamento!: number;

  @IsOptional()
  @IsString()
  estabelecimento?: string;

  @IsOptional()
  @IsString()
  previsao_em?: string;

  @IsOptional()
  @IsString()
  observacao_morador?: string;

  @IsOptional()
  @IsIn(['UNIDADE', 'PORTARIA'])
  modo_entrega?: 'UNIDADE' | 'PORTARIA';
}

export class AtualizarStatusDeliveryDto {
  @IsIn(STATUS_DELIVERY)
  status!: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsString()
  observacao?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  id_entregador?: number;
}

export class CriarEntregadorDto {
  @Type(() => Number)
  @IsInt()
  id_condominio!: number;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsOptional()
  @IsString()
  telefone?: string;

  @IsOptional()
  @IsString()
  documento?: string;

  @IsOptional()
  @IsString()
  plataforma?: string;

  @IsOptional()
  @IsString()
  foto?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VeiculoDeliveryDto)
  veiculo?: VeiculoDeliveryDto;
}

export class AtualizarEntregadorDto {
  @IsOptional()
  @IsString()
  nome?: string;

  @IsOptional()
  @IsString()
  telefone?: string;

  @IsOptional()
  @IsString()
  documento?: string;

  @IsOptional()
  @IsString()
  plataforma?: string;

  @IsOptional()
  @IsString()
  foto?: string;

  @IsOptional()
  @IsIn(['ATIVO', 'BLOQUEADO'])
  status?: 'ATIVO' | 'BLOQUEADO';

  @IsOptional()
  @IsString()
  motivo_bloqueio?: string;
}
