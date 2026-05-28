import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface TerminalFacial {
  id: number;
  id_condominio: number;
  nome: string;
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
}

export interface CreateTerminalFacial {
  nome: string;
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
  face_id: string;
  tipo_pessoa: string;
  id_pessoa: number;
  nome_pessoa: string;
  evento: string;
  confianca: number | null;
  timestamp: string;
  created_at: string;
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

  update(id: number, dto: Partial<CreateTerminalFacial>): Observable<TerminalFacial> {
    return this.http.put<TerminalFacial>(`${this.base}/devices/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/devices/${id}`);
  }

  test(id: number): Observable<{ online: boolean }> {
    return this.http.post<{ online: boolean }>(`${this.base}/devices/${id}/test`, {});
  }

  syncMorador(id: number): Observable<any> {
    return this.http.post<any>(`${this.base}/sync/morador/${id}`, {});
  }

  syncVisitante(id: number): Observable<any> {
    return this.http.post<any>(`${this.base}/sync/visitante/${id}`, {});
  }

  acessos(limit = 50): Observable<AcessoFacial[]> {
    const params = new HttpParams()
      .set('id_condominio', this.idCondominio)
      .set('limit', limit);
    return this.http.get<AcessoFacial[]>(`${this.base}/acessos`, { params });
  }
}
