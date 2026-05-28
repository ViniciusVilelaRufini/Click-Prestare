import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../../shared/api.config';
import { AuthService } from '../../auth/auth.service';

export interface RegraAcesso {
  id: number;
  id_condominio: number;
  nome: string;
  descricao: string | null;
  permitir_morador: number;
  permitir_visitante: number;
  permitir_prestador: number;
  permitir_funcionario: number;
  sentido: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  ativo: number;
  dispositivos: {
    id_dispositivo: number;
    dispositivo?: {
      id: number;
      nome: string;
      tipo: string;
    };
  }[];
  created_at: string;
  updated_at: string;
}

export interface CreateRegraAcesso {
  nome: string;
  descricao?: string;
  permitir_morador: number;
  permitir_visitante: number;
  permitir_prestador: number;
  permitir_funcionario: number;
  sentido: string;
  hora_inicio?: string | null;
  hora_fim?: string | null;
  ativo: number;
  dispositivosIds: number[];
}

@Injectable({ providedIn: 'root' })
export class RegrasAcessoService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const idCondo = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${idCondo}/regras-acesso`;
  }

  list(): Observable<RegraAcesso[]> {
    return this.http.get<RegraAcesso[]>(this.base);
  }

  get(id: number): Observable<RegraAcesso> {
    return this.http.get<RegraAcesso>(`${this.base}/${id}`);
  }

  create(dto: CreateRegraAcesso): Observable<RegraAcesso> {
    return this.http.post<RegraAcesso>(this.base, dto);
  }

  update(id: number, dto: Partial<CreateRegraAcesso>): Observable<RegraAcesso> {
    return this.http.put<RegraAcesso>(`${this.base}/${id}`, dto);
  }

  remove(id: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }
}
