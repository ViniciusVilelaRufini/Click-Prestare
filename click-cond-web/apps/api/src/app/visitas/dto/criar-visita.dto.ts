import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CriarPessoaDto } from '../../pessoas/dto/criar-pessoa.dto';

/**
 * Era uma `interface` — mesmo problema do `CriarPessoaDto`: o `ValidationPipe`
 * global não enxerga interfaces, então o body chegava sem validação nenhuma.
 * `@ValidateNested` + `@Type(() => CriarPessoaDto)` garante que o objeto
 * `pessoa` aninhado também passa pelas regras da classe (senão o
 * `class-transformer` o deixaria como objeto plano, e o `ValidationPipe`
 * nunca desceria para validar `pessoa.nome`).
 */
export class CriarVisitaDto {
  // Não é enviado pelo cliente: o controller sempre sobrescreve com o
  // `:idCondominio` da rota (`{ ...dto, id_condominio: idCondominio }`).
  // Opcional aqui só para não rejeitar o body que nunca o inclui.
  @IsOptional()
  @IsInt()
  id_condominio?: number;

  @IsInt()
  id_apartamento!: number;

  @IsOptional()
  @IsInt()
  user?: number | null;

  // @ValidateNested sozinho não valida `undefined` — o executor de
  // class-validator retorna cedo quando o valor está ausente, então um body
  // sem `pessoa` passava o pipe, chegava em `obterOuCriar(cond, undefined)` e
  // estourava TypeError (500 vazio) em `dto.nome.trim()`. `@IsDefined()`
  // fecha exatamente esse buraco.
  @IsDefined()
  @ValidateNested()
  @Type(() => CriarPessoaDto)
  pessoa!: CriarPessoaDto;

  @IsOptional()
  @IsIn([0, 1])
  is_visitante?: number;

  @IsOptional()
  @IsIn([0, 1])
  is_prestador?: number;

  @IsDefined()
  @IsDateString()
  data_hora_inicio!: Date | string;

  @IsDefined()
  @IsDateString()
  data_hora_termino!: Date | string;

  @IsOptional()
  @IsString()
  codigo_acesso?: string | null;

  @IsOptional()
  @IsIn([0, 1])
  liberado?: number;

  @IsOptional()
  @IsIn([0, 1])
  avisar?: number;

  @IsOptional()
  @IsString()
  tag_rfid?: string | null;

  @IsOptional()
  @IsString()
  dias_semana?: string | null;

  @IsOptional()
  @IsString()
  categorias?: string | null;

  @IsOptional()
  @IsString()
  auth_status?: string | null;
}
