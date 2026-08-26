import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

/** Condomínio do ERP Superlógica disponível para vínculo. */
export interface CondominioSuperlogica {
  idSuperlogica: number;
  nome: string;
  /** Preenchido quando já está vinculado a um condomínio do Clique. */
  vinculadoA: { id: number; nome: string } | null;
}

/** Condomínio do Clique e o estado do vínculo. */
export interface ClienteVinculo {
  id: number;
  nome: string;
  ativo: boolean;
  idSuperlogica: number | null;
  totalApartamentos: number;
  apartamentosVinculados: number;
}

export interface PreviewUnidades {
  totalNoErp: number;
  apartamentosNoClique: number;
  amostra: { idSuperlogica: number; bloco: string | null; unidade: string; contatos: number }[];
}

/**
 * Ativação da integração Superlógica. Todas as rotas exigem token de admin do
 * CRM e são somente leitura do lado do ERP — ver INTEGRACAO_SUPERLOGICA.md.
 */
@Injectable({ providedIn: 'root' })
export class SuperlogicaService {
  private http = inject(HttpClient);
  private base = `${API_BASE}/crm/superlogica`;

  status(): Observable<{ configurado: boolean }> {
    return this.http.get<{ configurado: boolean }>(`${this.base}/status`);
  }

  condominiosDoErp(): Observable<CondominioSuperlogica[]> {
    return this.http.get<CondominioSuperlogica[]>(`${this.base}/condominios`);
  }

  clientes(): Observable<ClienteVinculo[]> {
    return this.http.get<ClienteVinculo[]>(`${this.base}/clientes`);
  }

  previewUnidades(idCliente: number): Observable<PreviewUnidades> {
    return this.http.get<PreviewUnidades>(`${this.base}/clientes/${idCliente}/preview-unidades`);
  }

  vincular(idCliente: number, idSuperlogica: number): Observable<{ success: boolean; nomeSuperlogica: string }> {
    return this.http.post<{ success: boolean; nomeSuperlogica: string }>(
      `${this.base}/clientes/${idCliente}/vincular`,
      { idSuperlogica },
    );
  }

  desvincular(idCliente: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/clientes/${idCliente}/vincular`);
  }
}
