import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

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

  getMoradores(idCondominio: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_BASE}/condominios/${idCondominio}/moradores`);
  }

  createMorador(idCondominio: number, dto: any): Observable<any> {
    return this.http.post<any>(`${API_BASE}/condominios/${idCondominio}/moradores`, dto);
  }

  getApartamentos(idCondominio: number): Observable<any[]> {
    return this.http.get<any[]>(`${API_BASE}/condominios/${idCondominio}/apartamentos`);
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
}

