export interface Visitante {
  id: number;
  nome: string;
  doc_identificacao: string | null;
  data_hora_inicio: string | null;
  data_hora_termino: string | null;
  data_entrada: string | null;
  data_saida: string | null;
  is_visitante: number;
  is_prestador: number;
  id_apartamento: number;
  id_condominio: number;
  apto?: string;
  apto_bloco?: string;
  codigo_acesso?: string | null;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  created_at: string;
}

export interface CreateVisitante {
  nome: string;
  doc_identificacao?: string;
  data_hora_inicio?: string;
  data_hora_termino?: string;
  is_visitante?: number;
  is_prestador?: number;
  id_apartamento: number;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
}
