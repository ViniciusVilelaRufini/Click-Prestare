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
  /** Carimbo da última alteração (devolvido ao mudar status). */
  updated_at?: string | null;
  publica?: boolean;
  criadoPorNome?: string;
  prazo?: string | null;
  sla_horas?: number | null;
  id_responsavel?: number | null;
  responsavelNome?: string | null;
}

/**
 * O que a sessão pode fazer na tela (GET ocorrencias/acesso), pela mesma regra
 * das rotas: operar = ciente/solucionar/reabrir/responder/atribuir;
 * administrar = remover e alternar Pública/Privada; conversar = escrever no chat.
 */
export interface AcessoOcorrencias { operar: boolean; administrar: boolean; conversar: boolean; }

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

  acesso(): Observable<AcessoOcorrencias> {
    return this.http.get<AcessoOcorrencias>(`${this.base}/acesso`);
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

  /**
   * `visto`: o status e o updated_at que a tela mostrava — a API recusa (409)
   * se a ocorrência mudou desde então (lista de até 30 s atrás).
   */
  updateStatus(id: number, status: OcorrenciaStatus, visto?: { status?: string; updated_at?: string | null }): Observable<Ocorrencia> {
    return this.http.patch<Ocorrencia>(`${this.base}/${id}/status`, {
      status,
      ...(visto?.status ? { status_esperado: visto.status } : {}),
      ...(visto?.updated_at ? { updated_at_esperado: visto.updated_at } : {}),
    });
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

/**
 * Mensagem do chat. A do porteiro do console vem com `id_usuario` null,
 * `autor_tipo` 'portaria' e `usuario` preenchido com o rótulo
 * ("Portaria · João", is_sindico 0).
 */
export interface OcorrenciaMensagem {
  id: number;
  id_ocorrencia: number;
  id_usuario: number | null;
  mensagem: string;
  created_at: string;
  autor_tipo?: 'usuario' | 'portaria';
  usuario: {
    id: number | null;
    name: string;
    login_type: string;
    is_sindico: number;
  };
}
