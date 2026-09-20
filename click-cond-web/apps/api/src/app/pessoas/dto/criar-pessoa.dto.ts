export interface CriarPessoaDto {
  id_pessoa?: number;
  nome: string;
  doc_identificacao?: string | null;
  telefone?: string | null;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  tipo_pessoa?: 'visitante' | 'prestador';
  face_id?: string | null;
}
