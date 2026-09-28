import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

export type Canal = 'google' | 'openai' | 'instagram' | 'organico';
export type LeadStatus = 'novo' | 'em_contato' | 'proposta' | 'fechado' | 'perdido';

export interface CanalResumo {
  canal: Canal; impressoes: number | null; cliques: number | null; ctr: number | null; gasto: number | null;
  conversoesPlataforma: number | null; leads: number; custoPorLead: number | null; fechados: number;
}
export interface ResumoMarketing {
  periodo: { de: string; ate: string };
  investimento: number; leads: number; custoPorLead: number | null; fechados: number; custoPorContrato: number | null;
  canais: CanalResumo[];
  diario: { dia: string; gasto: number; leads: number }[];
  frescor: { google: string | null; openai: string | null };
}
export interface Lead {
  id: number; nome: string; condominio: string; unidades: string; whatsapp: string; origem: Canal;
  status: LeadStatus; observacao: string | null; criadoEm: string; statusEm: string | null;
}

@Injectable({ providedIn: 'root' })
export class MarketingApi {
  private http = inject(HttpClient);
  private base = `${API_BASE}/crm/marketing`;

  resumo(de: string, ate: string): Observable<ResumoMarketing> {
    return this.http.get<ResumoMarketing>(`${this.base}/resumo`, { params: { de, ate } });
  }
  leads(f: { de: string; ate: string; status?: string; origem?: string }): Observable<Lead[]> {
    const params: Record<string, string> = { de: f.de, ate: f.ate };
    if (f.status) params['status'] = f.status;
    if (f.origem) params['origem'] = f.origem;
    return this.http.get<Lead[]>(`${this.base}/leads`, { params });
  }
  atualizar(id: number, p: { status?: LeadStatus; observacao?: string }): Observable<Lead> {
    return this.http.patch<Lead>(`${this.base}/leads/${id}`, p);
  }
}
