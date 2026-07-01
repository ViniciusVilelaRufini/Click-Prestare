import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Prestador {
  id: number;
  nome: string;
  telefone: string | null;
  categorias: string | null;
  id_condominio: number;
  id_apartamento?: number | null;
  apartamento?: { bloco: string | null; apto: string | null } | null;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  dias_semana?: string | null;
}
export interface CreatePrestador {
  nome: string;
  telefone?: string;
  categorias?: string;
  id_apartamento?: number;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  dias_semana?: string;
}

@Injectable({ providedIn: 'root' })
export class PrestadoresApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/prestadores`;
  }

  list(search?: string): Observable<Prestador[]> {
    let params = new HttpParams();
    if (search) params = params.set('search', search);

    return this.http.get<Prestador[]>(this.base, { params });
  }

  create(dto: CreatePrestador): Observable<Prestador> {
    return this.http.post<Prestador>(this.base, dto);
  }

  update(id: number, dto: Partial<CreatePrestador>): Observable<Prestador> {
    return this.http.put<Prestador>(`${this.base}/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }
}
