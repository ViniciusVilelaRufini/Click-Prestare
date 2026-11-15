import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Comunicado {
  id: number;
  titulo: string;
  descricao: string | null;
  created_at: string;
}

export interface CreateComunicado {
  titulo: string;
  descricao?: string;
}

@Injectable({ providedIn: 'root' })
export class ComunicadosApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/comunicados`;
  }

  /** Mesma regra das rotas de escrita: o funcionário do app sem a flag `comunicados` não gerencia. */
  acesso(): Observable<{ gerenciar: boolean }> {
    return this.http.get<{ gerenciar: boolean }>(`${this.base}/acesso`);
  }

  list(): Observable<Comunicado[]> {
    return this.http.get<Comunicado[]>(this.base);
  }

  create(dto: CreateComunicado): Observable<Comunicado> {
    return this.http.post<Comunicado>(this.base, dto);
  }

  update(id: number, dto: CreateComunicado): Observable<Comunicado> {
    return this.http.put<Comunicado>(`${this.base}/${id}`, dto);
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }
}
