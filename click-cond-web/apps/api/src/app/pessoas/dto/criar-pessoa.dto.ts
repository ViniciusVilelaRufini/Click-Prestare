import { IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Era uma `interface` — o `ValidationPipe` global (main.ts, `whitelist: true,
 * transform: true`) só enxerga `class`es: interface é apagada na compilação,
 * então o corpo da requisição chegava sem NENHUMA validação. Um `nome`
 * ausente só quebrava depois, em `dto.nome.trim()`, como TypeError → 500 com
 * corpo vazio (em vez de um 400 com mensagem explicando o campo faltando).
 */
export class CriarPessoaDto {
  @IsOptional()
  @IsInt()
  id_pessoa?: number;

  @IsString()
  @MinLength(1)
  nome!: string;

  @IsOptional()
  @IsString()
  doc_identificacao?: string | null;

  @IsOptional()
  @IsString()
  telefone?: string | null;

  @IsOptional()
  @IsString()
  foto_pessoa?: string | null;

  @IsOptional()
  @IsString()
  foto_documento?: string | null;

  @IsOptional()
  @IsIn(['visitante', 'prestador'])
  tipo_pessoa?: 'visitante' | 'prestador';

  @IsOptional()
  @IsString()
  face_id?: string | null;
}
