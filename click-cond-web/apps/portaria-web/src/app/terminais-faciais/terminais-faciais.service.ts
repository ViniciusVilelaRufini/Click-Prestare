import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface TerminalFacial {
  id: number;
  id_condominio: number;
  nome: string;
  tipo: string;
  /** auto | entrada | saida */
  sentido: string;
  /** Confiança mínima (%) do reconhecimento; 0 = desligado. */
  confianca_minima: number;
  fabricante: string;
  modelo: string | null;
  ip: string;
  porta: number;
  api_user: string | null;
  api_password: string | null;
  webhook_token: string;
  ativo: number;
  ultima_sincr: string | null;
  created_at: string;
  updated_at: string;
  /** True se há um Agente Local fazendo polling deste device agora. */
  agent_online?: boolean;
  /**
   * Status do APARELHO na LAN, do heartbeat do agente:
   * true=online, false=offline, null/undefined=desconhecido (sem reporte recente).
   */
  device_online?: boolean | null;
}

export interface CreateTerminalFacial {
  nome: string;
  tipo?: string;
  sentido?: string;
  confianca_minima?: number;
  fabricante: string;
  modelo?: string;
  ip: string;
  porta?: number;
  api_user?: string;
  api_password?: string;
}

export interface AcessoFacial {
  id: number;
  id_condominio: number;
  id_device: number;
  tipo_dispositivo: string;
  face_id: string;
  tipo_pessoa: string;
  id_pessoa: number | null;
  nome_pessoa: string;
  evento: string;
  confianca: number | null;
  timestamp: string;
  created_at: string;
}

export interface FacialSyncStatus {
  synced: number;
  pending: number;
  error: number;
  semFoto: number;
  comFoto: number;
  total: number;
  running: boolean;
}

export interface SyncPessoa {
  tipo: 'morador' | 'visitante';
  categoria: string; // morador | funcionario | visitante | prestador
  id: number;
  nome: string;
  tem_foto: boolean;
  status: 'synced' | 'error' | 'pending' | 'no_photo';
  motivo: string;
}

@Injectable({ providedIn: 'root' })
export class TerminaisFaciaisApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    return `${API_BASE}/facial`;
  }

  private get idCondominio(): number {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  list(): Observable<TerminalFacial[]> {
    const params = new HttpParams().set('id_condominio', this.idCondominio);
    return this.http.get<TerminalFacial[]>(`${this.base}/devices`, { params });
  }

  create(dto: CreateTerminalFacial): Observable<TerminalFacial> {
    return this.http.post<TerminalFacial>(`${this.base}/devices`, {
      ...dto,
      id_condominio: this.idCondominio,
    });
  }

  update(
    id: number,
    dto: Partial<CreateTerminalFacial>,
  ): Observable<TerminalFacial> {
    return this.http.put<TerminalFacial>(`${this.base}/devices/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/devices/${id}`);
  }

  test(id: number): Observable<{ online: boolean }> {
    return this.http.post<{ online: boolean }>(
      `${this.base}/devices/${id}/test`,
      {},
    );
  }

  trigger(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.base}/devices/${id}/trigger`,
      {},
    );
  }

  syncMorador(id: number): Observable<any> {
    return this.http.post<any>(`${this.base}/sync/morador/${id}`, {});
  }

  syncVisitante(id: number): Observable<any> {
    return this.http.post<any>(`${this.base}/sync/visitante/${id}`, {});
  }

  /**
   * Envia rostos para os terminais faciais. Opcional: filtrar por categoria
   * (morador/visitante/prestador/funcionario) e/ou por terminais (deviceIds).
   * Sem filtros = todos para todos os terminais.
   */
  syncAll(
    categorias?: string[],
    deviceIds?: number[],
  ): Observable<{
    total?: number;
    started?: boolean;
    skipped?: boolean;
    reason?: string;
    alreadyRunning?: boolean;
  }> {
    let params = new HttpParams().set('id_condominio', this.idCondominio);
    if (categorias?.length) params = params.set('categorias', categorias.join(','));
    if (deviceIds?.length) params = params.set('deviceIds', deviceIds.join(','));
    return this.http.post<any>(`${this.base}/sync/all`, {}, { params });
  }

  /**
   * Remove rostos dos terminais faciais. Opcional: filtrar por categoria
   * e/ou por terminais (deviceIds).
   */
  unsyncAll(
    categorias?: string[],
    deviceIds?: number[],
  ): Observable<{
    total?: number;
    started?: boolean;
    skipped?: boolean;
    reason?: string;
    alreadyRunning?: boolean;
  }> {
    let params = new HttpParams().set('id_condominio', this.idCondominio);
    if (categorias?.length) params = params.set('categorias', categorias.join(','));
    if (deviceIds?.length) params = params.set('deviceIds', deviceIds.join(','));
    return this.http.post<any>(`${this.base}/sync/clean`, {}, { params });
  }

  /** Contadores do progresso de sincronização facial dos moradores. */
  syncStatus(): Observable<FacialSyncStatus> {
    const params = new HttpParams().set('id_condominio', this.idCondominio);
    return this.http.get<FacialSyncStatus>(`${this.base}/sync/status`, {
      params,
    });
  }

  /** Lista por pessoa: quem está pendente/erro e por quê (com motivo legível). */
  syncPessoas(): Observable<SyncPessoa[]> {
    const params = new HttpParams().set('id_condominio', this.idCondominio);
    return this.http.get<SyncPessoa[]>(`${this.base}/sync/pessoas`, { params });
  }

  acessos(limit = 50): Observable<AcessoFacial[]> {
    const params = new HttpParams()
      .set('id_condominio', this.idCondominio)
      .set('limit', limit);
    return this.http.get<AcessoFacial[]>(`${this.base}/acessos`, { params });
  }

  /** Chave do agente do condomínio + URL de download do executável. */
  agentInfo(): Observable<{
    agent_token: string;
    download_url: string | null;
  }> {
    const params = new HttpParams().set('id_condominio', this.idCondominio);
    return this.http.get<{ agent_token: string; download_url: string | null }>(
      `${this.base}/agent/info`,
      { params },
    );
  }

  /** Baixa o arquivo de config do agente já personalizado (.env ou instalar.bat). */
  downloadAgentConfig(format: 'env' | 'bat'): Observable<Blob> {
    const params = new HttpParams()
      .set('id_condominio', this.idCondominio)
      .set('format', format);
    return this.http.get(`${this.base}/agent/config`, {
      params,
      responseType: 'blob',
    });
  }

  snapshot(deviceId: number): Observable<{ foto: string }> {
    return this.http.post<{ foto: string }>(
      `${this.base}/devices/${deviceId}/snapshot`,
      {},
    );
  }
}
