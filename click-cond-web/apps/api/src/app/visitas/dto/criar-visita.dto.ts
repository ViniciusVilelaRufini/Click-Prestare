import { CriarPessoaDto } from '../../pessoas/dto/criar-pessoa.dto';

export interface CriarVisitaDto {
  id_condominio: number;
  id_apartamento: number;
  user?: number | null;
  pessoa: CriarPessoaDto;
  is_visitante?: number;
  is_prestador?: number;
  data_hora_inicio?: Date | string | null;
  data_hora_termino?: Date | string | null;
  codigo_acesso?: string | null;
  liberado?: number;
  avisar?: number;
  tag_rfid?: string | null;
  dias_semana?: string | null;
  categorias?: string | null;
  auth_status?: string | null;
}
