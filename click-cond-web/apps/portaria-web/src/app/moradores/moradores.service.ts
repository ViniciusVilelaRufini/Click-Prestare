import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Morador {
  id: number;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  data_nascimento: string | null;
  tipo: string | null;
  bloco: string | null;
  apartamento: string | null;
  id_apartamento: number;
  id_condominio: number;
  photo: string | null;
  foto_pessoa: string | null;
  foto_documento: string | null;
}

export interface CreateMorador {
  nome: string;
  documento?: string;
  email?: string;
  telefone?: string;
  tipo?: string;
  id_apartamento: number;
  sendCredentials?: boolean;
  foto_pessoa?: string;
  foto_documento?: string;
}

@Injectable({ providedIn: 'root' })
export class MoradoresApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/moradores`;
  }

  list(search?: string): Observable<Morador[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);

    return this.http.get<Morador[]>(this.base, { params });
  }

  create(dto: CreateMorador): Observable<Morador> {
    return this.http.post<Morador>(this.base, dto);
  }

  update(id: number, dto: Partial<CreateMorador>): Observable<Morador> {
    return this.http.put<Morador>(`${this.base}/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }

  sendCredentials(id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base}/${id}/send-credentials`, {});
  }

  exportExcel(): Observable<{ base64: string; filename: string }> {
    return this.http.get<{ base64: string; filename: string }>(`${this.base}/export-excel`);
  }

  importBulk(linhas: any[]): Observable<{ ok: boolean; total: number; criados: any[] }> {
    return this.http.post<{ ok: boolean; total: number; criados: any[] }>(`${this.base}/import-bulk`, { linhas });
  }
}
