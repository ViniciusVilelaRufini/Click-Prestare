import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface DashboardSummary {
  visitantesAtivos: number;
  prestadoresAtivos: number;
  ocorrenciasPendentes: number;
  encomendasAguardando: number;
  comunicadosRecentes: number;
  totalApartamentos: number;
  totalMoradores: number;
  ultimosEventos: {
    tipo: string;
    descricao: string;
    quando: string;
    direcao?: 'entrada' | 'saida' | 'negado' | 'bloqueado';
    detalhes: {
      id: number;
      nome?: string;
      documento?: string;
      blocoApto?: string;
      tipoPessoa?: 'morador' | 'visitante' | 'prestador' | 'funcionario';
      dataEntrada?: string;
      dataSaida?: string;
      autorizadoPor?: string;
      status?: string;
      recebidoDe?: string;
      retiradoPor?: string;
      recebidoPor?: string;
      descricao?: string;
      resposta?: string;
      fotoPessoa?: string;
      fotoDocumento?: string;
      metodoLiberacao?: 'facial' | 'pin' | 'manual';
      metodoLabel?: string;
      confianca?: number;
      terminalNome?: string;
      historicoAcessos?: {
        evento: 'entrada' | 'saida' | 'negado';
        timestamp: string;
        metodo: 'facial' | 'pin' | 'manual';
        metodoLabel: string;
        confianca?: number;
        terminalNome?: string;
      }[];
    };
  }[];
}

@Injectable({ providedIn: 'root' })
export class DashboardApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/dashboard`;
  }

  get(): Observable<DashboardSummary> {
    return this.http.get<DashboardSummary>(this.base);
  }
}
