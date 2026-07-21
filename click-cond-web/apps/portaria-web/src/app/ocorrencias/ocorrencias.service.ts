import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export type OcorrenciaStatus = 'Pendente' | 'Ciente' | 'Solucionado';

export interface Categoria { id: number; nome: string; prioridade: number; sla_horas?: number | null; }

export interface FuncionarioAtribuivel { id_user: number; nome: string; funcao?: string; }

export interface Ocorrencia {
  id: number;
  descricao: string;
  status: OcorrenciaStatus;
  resposta: string | null;
  resposta_at: string | null;
  tipo: number;
  tipoNome?: string;
  created_at: string;
  publica?: boolean;
  criadoPorNome?: string;
  prazo?: string | null;
  sla_horas?: number | null;
  id_responsavel?: number | null;
  responsavelNome?: string | null;
}

export interface CreateOcorrencia {
  descricao: string;
  tipo: number;
}

@Injectable({ providedIn: 'root' })
export class OcorrenciasApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/ocorrencias`;
  }

  list(status?: string): Observable<Ocorrencia[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);

    return this.http.get<Ocorrencia[]>(this.base, { params });
  }

  categorias(): Observable<Categoria[]> {
    return this.http.get<Categoria[]>(`${this.base}/categorias`);
  }

  criarCategoria(dto: { nome: string; prioridade?: number; sla_horas?: number | null }): Observable<Categoria> {
    return this.http.post<Categoria>(`${this.base}/categorias`, dto);
  }

  atualizarCategoria(id: number, dto: { nome?: string; prioridade?: number; sla_horas?: number | null }): Observable<Categoria> {
    return this.http.patch<Categoria>(`${this.base}/categorias/${id}`, dto);
  }

  removerCategoria(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/categorias/${id}`);
  }

  funcionarios(): Observable<FuncionarioAtribuivel[]> {
    return this.http.get<FuncionarioAtribuivel[]>(`${this.base}/funcionarios`);
  }

  atribuir(id: number, idResponsavel: number | null): Observable<Ocorrencia> {
    return this.http.patch<Ocorrencia>(`${this.base}/${id}/responsavel`, { id_responsavel: idResponsavel });
  }

  create(dto: CreateOcorrencia): Observable<Ocorrencia> {
    return this.http.post<Ocorrencia>(this.base, dto);
  }

  updateStatus(id: number, status: OcorrenciaStatus): Observable<Ocorrencia> {
    return this.http.patch<Ocorrencia>(`${this.base}/${id}/status`, { status });
  }

  updatePublica(id: number, publica: boolean): Observable<Ocorrencia> {
    return this.http.patch<Ocorrencia>(`${this.base}/${id}/publica`, { publica });
  }

  updateResposta(id: number, resposta: string): Observable<Ocorrencia> {
    return this.http.patch<Ocorrencia>(`${this.base}/${id}/resposta`, { resposta });
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }

  listMessages(id: number): Observable<OcorrenciaMensagem[]> {
    return this.http.get<OcorrenciaMensagem[]>(`${this.base}/${id}/mensagens`);
  }

  sendMessage(id: number, mensagem: string): Observable<OcorrenciaMensagem> {
    return this.http.post<OcorrenciaMensagem>(`${this.base}/${id}/mensagens`, { mensagem });
  }
}

export interface OcorrenciaMensagem {
  id: number;
  id_ocorrencia: number;
  id_usuario: number;
  mensagem: string;
  created_at: string;
  usuario: {
    id: number;
    name: string;
    login_type: string;
    is_sindico: number;
  };
}
