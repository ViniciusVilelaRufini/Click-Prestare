import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import type { Apartamento, Morador } from './crm.models';

export type EstagioCrm = 'lead' | 'trial' | 'ativo' | 'em_atraso' | 'churn';
export type StatusPagamento = 'em_dia' | 'vencendo' | 'atrasado' | 'sem_cobranca';

export type RiscoNivel = 'alto' | 'medio' | 'baixo';
export interface RiscoMotivo {
  tipo: 'offline' | 'inatividade' | 'suporte';
  texto: string;
  severidade: 'alta' | 'media' | 'baixa';
}
export interface RiscoChurn {
  nivel: RiscoNivel;
  score: number;
  motivos: RiscoMotivo[];
}

export interface CrmContato {
  nome: string;
  email: string | null;
  telefone: string | null;
  papel: string;
}

export interface CrmCliente {
  id: number;
  nome: string;
  identificacao: string | null;
  photo: string | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
  estagio: EstagioCrm;
  plano: string | null;
  mrr: number;
  vencimento: string | null;
  diasParaVencer: number | null;
  statusPagamento: StatusPagamento;
  contatoPrincipal: CrmContato | null;
  healthScore: number;
  riscoChurn: RiscoChurn;
  totalApartamentos: number;
  totalMoradores: number;
  ocorrenciasPendentes: number;
  visitantesAtivos: number;
  acessos30d: number;
  ultimaAtividade: string | null;
  clienteDesde: string | null;
  totalPorteiros: number;
  totalFuncionarios: number;
  dispositivosFaciais: number;
  dispositivosOffline: number;
  moradoresComFace: number;
  moradoresComTag: number;
  encomendasAguardando: number;
  encomendasRecebidas30d: number;
  comunicados30d: number;
  reservasAreas30d: number;
  recorrenciaAtiva: boolean;
  cobrancaAutoWhats: boolean;
  prestadoresCadastrados: number;
  assembleiasAgendadas: number;
}

export interface CrmOverview {
  totalClientes: number;
  clientesAtivos: number;
  mrrTotal: number;
  arrTotal: number;
  ticketMedio: number;
  emAtraso: { quantidade: number; valor: number };
  vencendo7d: { quantidade: number; valor: number };
  novos30d: number;
  churn: number;
  taxaChurn: number;
  porEstagio: Record<EstagioCrm, number>;
  porPlano: { plano: string; clientes: number; mrr: number }[];
  topClientes: { id: number; nome: string; mrr: number; healthScore: number }[];
  alertas: {
    id: number;
    nome: string;
    tipo: 'vencimento' | 'atraso' | 'health' | 'inativo' | 'offline' | 'inatividade' | 'suporte';
    mensagem: string;
    severidade: 'alta' | 'media' | 'baixa';
  }[];
}

export interface CrmHealth {
  connected: boolean;
  mode: 'live' | 'mock';
  totalCondominios: number;
  serverTime: string;
  dbLatencyMs: number;
}

/** Payload de criação de condomínio — espelha CriarCondominioDto da API. */
export interface NovoCondominioDto {
  nome: string;
  identificacao?: string | null;
  plano?: string | null;
  valorMensal?: number | null;
  diaVencimento?: number | null;
  sindico?: {
    nome: string;
    email: string;
    telefone?: string | null;
    documento?: string | null;
  } | null;
  apartamentos?: { blocos: string[]; andares: number; porAndar: number } | null;
}

export interface CriarCondominioResposta {
  id: number;
  nome: string;
  apartamentosCriados: number;
  sindicoCriado: boolean;
  /** Devolvida uma única vez pela API, para entregar ao síndico. */
  senhaSindico: string | null;
}

export interface ResumoDesativacao {
  moradores: number;
  funcionarios: number;
  terminais: number;
  apartamentos: number;
}

export interface ResultadoPurga extends ResumoDesativacao {
  success: boolean;
  nome: string;
  contasRemovidas: number;
  contasPreservadas: number;
  terminaisLimpos: number;
  terminaisComFalha: string[];
}

@Injectable({ providedIn: 'root' })
export class CrmApi {
  private http = inject(HttpClient);
  private base = `${API_BASE}/crm`;

  health(): Observable<CrmHealth> {
    return this.http.get<CrmHealth>(`${this.base}/health`);
  }

  overview(): Observable<CrmOverview> {
    return this.http.get<CrmOverview>(`${this.base}/overview`);
  }

  clientes(): Observable<CrmCliente[]> {
    return this.http.get<CrmCliente[]>(`${this.base}/clientes`);
  }

  cliente(id: number): Observable<CrmCliente> {
    return this.http.get<CrmCliente>(`${this.base}/clientes/${id}`);
  }

  atualizar(id: number, data: any): Observable<{ success: boolean; data: CrmCliente }> {
    return this.http.put<{ success: boolean; data: CrmCliente }>(`${this.base}/clientes/${id}`, data);
  }

  exportarUrl(id: number): string {
    return `${this.base}/clientes/${id}/exportar`;
  }

  // ── Ciclo de vida do condomínio ──
  // A exclusão é em duas fases no servidor: desativar corta o acesso (app,
  // portaria e facial) e é reversível; purgar apaga em cascata e exige o
  // condomínio já desativado mais o nome digitado por extenso.

  criarCondominio(dto: NovoCondominioDto): Observable<CriarCondominioResposta> {
    return this.http.post<CriarCondominioResposta>(`${this.base}/clientes`, dto);
  }

  desativarCondominio(id: number, motivo: string): Observable<{ success: boolean; data: ResumoDesativacao }> {
    return this.http.post<{ success: boolean; data: ResumoDesativacao }>(
      `${this.base}/clientes/${id}/desativar`,
      { motivo },
    );
  }

  reativarCondominio(id: number): Observable<{ success: boolean; nome: string }> {
    return this.http.post<{ success: boolean; nome: string }>(
      `${this.base}/clientes/${id}/reativar`,
      {},
    );
  }

  purgarCondominio(id: number, confirmacao: string): Observable<ResultadoPurga> {
    return this.http.delete<ResultadoPurga>(`${this.base}/clientes/${id}`, {
      body: { confirmacao },
    });
  }

  // Rotas do próprio CRM (CrmAdminGuard). As antigas /condominios/:id/*
  // passam pelo TenantGuard e respondem 403 para o token da operadora.
  getMoradores(idCondominio: number): Observable<Morador[]> {
    return this.http.get<Morador[]>(`${this.base}/clientes/${idCondominio}/moradores`);
  }

  createMorador(idCondominio: number, dto: unknown): Observable<Morador> {
    return this.http.post<Morador>(`${this.base}/clientes/${idCondominio}/moradores`, dto);
  }

  getApartamentos(idCondominio: number): Observable<Apartamento[]> {
    return this.http.get<Apartamento[]>(`${this.base}/clientes/${idCondominio}/apartamentos`);
  }

  /** Terminais faciais do condomínio com online/offline por terminal. */
  getTerminais(idCondominio: number): Observable<CrmTerminal[]> {
    return this.http.get<CrmTerminal[]>(`${this.base}/clientes/${idCondominio}/terminais`);
  }

  getOcorrencias(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/ocorrencias`);
  }

  responderOcorrencia(id: number, resposta: string): Observable<any> {
    return this.http.put<any>(`${this.base}/ocorrencias/${id}`, { resposta });
  }

  criarOcorrencia(idCondominio: number, descricao: string): Observable<any> {
    return this.http.post<any>(`${this.base}/ocorrencias`, { idCondominio, descricao });
  }

  listMessages(idOcorrencia: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/ocorrencias/${idOcorrencia}/mensagens`);
  }

  sendMessage(idOcorrencia: number, mensagem: string): Observable<any> {
    return this.http.post<any>(`${this.base}/ocorrencias/${idOcorrencia}/mensagens`, { mensagem });
  }

  reabrirOcorrencia(id: number, novasInformacoes: string): Observable<any> {
    return this.http.put<any>(`${this.base}/ocorrencias/${id}/reabrir`, { novasInformacoes });
  }

  // ============== Faturamento real ==============

  faturas(): Observable<CrmFatura[]> {
    return this.http.get<CrmFatura[]>(`${this.base}/faturas`);
  }

  gerarFaturas(referencia?: string): Observable<any> {
    return this.http.post<any>(`${this.base}/faturas/gerar`, { referencia });
  }

  baixarFatura(id: number, dados: { metodo: string; motivo: string; dataPagamento?: string; valorPago?: number }): Observable<any> {
    return this.http.post<any>(`${this.base}/faturas/${id}/baixa`, dados);
  }

  cobrarWhatsApp(id: number): Observable<any> {
    return this.http.post<any>(`${this.base}/faturas/${id}/cobrar-whatsapp`, {});
  }

  getConfig(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.base}/config`);
  }

  setConfig(entries: Record<string, unknown>): Observable<any> {
    return this.http.post<any>(`${this.base}/config`, entries);
  }

  gatewaysStatus(): Observable<{ openpix: boolean; openpixWebhook: boolean; asaasWebhook: boolean; zapi: boolean }> {
    return this.http.get<{ openpix: boolean; openpixWebhook: boolean; asaasWebhook: boolean; zapi: boolean }>(`${this.base}/config/gateways-status`);
  }

  disparos(): Observable<CrmDisparo[]> {
    return this.http.get<CrmDisparo[]>(`${this.base}/disparos`);
  }
}

export interface CrmFatura {
  id: number;
  clienteId: number;
  condominio: string;
  referencia: string;
  valor: number;
  vencimento: string | null;
  status: 'pendente' | 'paga' | 'vencida' | 'cancelada';
  metodoPagamento: string | null;
  dataPagamento: string | null;
  baixaPor: string | null;
  baixaMotivo: string | null;
  estimada: boolean;
}

/** Terminal facial como o CRM enxerga (status calculado no backend). */
export interface CrmTerminal {
  id: number;
  nome: string;
  fabricante: string;
  modelo: string | null;
  ip: string;
  tipo: string;
  ativo: boolean;
  /** Status ao vivo do aparelho na LAN; null = sem reporte recente do agente. */
  online: boolean | null;
  /** O agente local está fazendo polling deste terminal agora. */
  agenteConectado: boolean;
  ultimaSincr: string | null;
}

export interface CrmDisparo {
  id: number;
  condominio: string;
  idFatura: number | null;
  tipo: string;
  telefone: string | null;
  status: 'enviado' | 'falha';
  erro: string | null;
  data: string;
}


