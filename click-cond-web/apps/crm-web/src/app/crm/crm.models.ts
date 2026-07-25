import { EstagioCrm } from './crm.service';

/** Fatura no formato de exibição do CRM (derivada de CrmFatura do backend). */
export interface Fatura {
  id: string;          // identificador de exibição (FT-MM-YYYY-cliente)
  dbId: number;        // id real em Crm_Faturas — usado na baixa/cobrança
  clienteId: number;
  condominio: string;
  referencia: string;
  valor: number;
  vencimento: string;
  metodoPagamento: string;
  status: 'paga' | 'pendente' | 'vencida';
  dataPagamento: string | null;
  baixaPor: string | null;
  baixaMotivo: string | null;
  estimada: boolean;
}

export type StatusFatura = 'todos' | 'paga' | 'pendente' | 'vencida';
export type EstagioFiltro = 'todos' | EstagioCrm;
export type Ordenacao = 'mrr' | 'health' | 'nome' | 'vencimento';

/** Campos editáveis do condomínio no drawer (enviados ao PUT /crm/clientes/:id). */
export interface ClienteEdicao {
  nome: string;
  identificacao: string;
  plano: string;
  totalApartamentos: number;
  mrr: number;
  vencimento: string;
  recorrenciaAtiva: boolean;
  cobrancaAutoWhats: boolean;
  sindicoNome: string;
  sindicoEmail: string;
  sindicoTelefone: string;
}

export interface Morador {
  id: number;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  tipo: string;
  bloco: string | null;
  apartamento: string | null;
  id_apartamento: number | null;
  id_condominio: number;
  photo: string | null;
  face_id: string | null;
  face_sync_status: string | null;
}

export interface Apartamento {
  id: number;
  apto: string;
  bloco: string | null;
  id_condominio: number;
}

export interface OcorrenciaCategoria {
  nome: string;
}

export interface Ocorrencia {
  id: number;
  descricao: string;
  resposta: string | null;
  resposta_at: string | null;
  status: string;
  created_at: string;
  categoria: OcorrenciaCategoria | null;
  condominio: { nome: string } | null;
  criadoPor: { name: string } | null;
}

export interface ChatMensagem {
  id: number;
  mensagem: string;
  created_at: string;
  usuario: { name: string; is_sindico: number } | null;
}

export interface ConfigAutomacoes {
  triggerPreVencimento: boolean;
  diasPreVencimento: number;
  templatePreVencimento: string;
  triggerVencimento: boolean;
  templateVencimento: string;
  triggerPosVencimento: boolean;
  diasPosVencimento: number;
  templatePosVencimento: string;
}

export interface ConfigPlano {
  plano: string;
  sistema: string;
  valorBase: number;
  valorPorUH: number;
}

export interface GatewaysStatus {
  openpix: boolean;
  openpixWebhook: boolean;
  asaasWebhook: boolean;
  zapi: boolean;
}

export interface DisparoView {
  data: string;
  condominio: string;
  tipo: string;
  status: string;
  telefone: string | null;
  erroMsg: string | null;
}

export interface LogWebhook {
  data: string;
  origem: string;
  evento: string;
  status: string;
  payload: string;
}

export interface BaixaManualMetadata {
  metodo: string;
  dataPagamento: string;
  valorPago: number;
  obs: string;
}
