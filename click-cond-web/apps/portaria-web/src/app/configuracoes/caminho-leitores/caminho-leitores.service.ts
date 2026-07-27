import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../../shared/api.config';
import { AuthService } from '../../auth/auth.service';

export interface DispositivoResumo {
  id: number;
  nome: string;
  tipo: string;
  ativo: number;
}

export interface EtapaCaminho {
  id?: number;
  ordem: number;
  id_leitor: number;
  id_abertura: number | null;
  leitor?: DispositivoResumo | null;
  abertura?: DispositivoResumo | null;
}

export interface CaminhoAcesso {
  id: number;
  id_condominio: number;
  nome: string;
  descricao: string | null;
  ativo: number;
  etapas: EtapaCaminho[];
  created_at: string;
  updated_at: string;
}

export interface SalvarCaminho {
  nome: string;
  descricao?: string | null;
  ativo: number;
  /** A posição no array define a ordem da etapa. */
  etapas: { id_leitor: number; id_abertura: number | null }[];
}

@Injectable({ providedIn: 'root' })
export class CaminhoLeitoresService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const idCondo = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${idCondo}/caminhos-acesso`;
  }

  list(): Observable<CaminhoAcesso[]> {
    return this.http.get<CaminhoAcesso[]>(this.base);
  }

  create(dto: SalvarCaminho): Observable<CaminhoAcesso> {
    return this.http.post<CaminhoAcesso>(this.base, dto);
  }

  update(id: number, dto: SalvarCaminho): Observable<CaminhoAcesso> {
    return this.http.put<CaminhoAcesso>(`${this.base}/${id}`, dto);
  }

  remove(id: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/${id}`);
  }

  /**
   * Dispositivos do condomínio, para montar as etapas.
   *
   * `id_condominio` é obrigatório na rota (ParseIntPipe): sem ele a chamada
   * volta 400 e a lista de leitores aparece vazia.
   */
  listDispositivos(): Observable<DispositivoResumo[]> {
    const idCondo = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return this.http.get<DispositivoResumo[]>(
      `${API_BASE}/facial/devices?id_condominio=${idCondo}`,
    );
  }
}
