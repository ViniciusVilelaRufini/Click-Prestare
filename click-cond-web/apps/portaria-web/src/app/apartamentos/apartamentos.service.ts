import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Apartamento {
  id: number;
  bloco: string | null;
  apto: string;
  fracao: string | null;
  qtd_vagas?: number;
  id_condominio: number;
  qtdMoradores?: number;
}

export interface CreateApartamento {
  bloco?: string;
  apto: string;
  fracao?: string;
  qtd_vagas?: number;
}

@Injectable({ providedIn: 'root' })
export class ApartamentosApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/apartamentos`;
  }

  list(search?: string): Observable<Apartamento[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);

    return this.http.get<Apartamento[]>(this.base, { params });
  }

  create(dto: CreateApartamento): Observable<Apartamento> {
    return this.http.post<Apartamento>(this.base, dto);
  }

  update(id: number, dto: Partial<CreateApartamento>): Observable<Apartamento> {
    return this.http.put<Apartamento>(`${this.base}/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }

  importBulk(linhas: any[]): Observable<{ ok: boolean; total: number; criados: any[] }> {
    return this.http.post<{ ok: boolean; total: number; criados: any[] }>(`${this.base}/import-bulk`, { linhas });
  }
}
