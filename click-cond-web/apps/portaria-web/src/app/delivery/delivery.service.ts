import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { API_BASE } from '../shared/api.config';
import {
  AtualizarEntregadorDelivery,
  CriarEntregadorDelivery,
  DeliveryAtendimento,
  DeliveryEntregador,
  DeliveryResumo,
  DeliveryStatus,
} from './delivery.model';

export type {
  AtualizarEntregadorDelivery,
  CriarEntregadorDelivery,
  DeliveryAtendimento,
  DeliveryEntregador,
  DeliveryResumo,
  DeliveryStatus,
} from './delivery.model';

@Injectable({ providedIn: 'root' })
export class DeliveryApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private get idCondominio(): number {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  listAtivos(): Observable<DeliveryAtendimento[]> {
    const params = new HttpParams().set('id_condominio', this.idCondominio).set('escopo', 'ativos');
    return this.http.get<DeliveryAtendimento[]>(`${API_BASE}/delivery`, { params });
  }

  listHistorico(de: string, ate: string): Observable<DeliveryAtendimento[]> {
    const params = new HttpParams()
      .set('id_condominio', this.idCondominio).set('escopo', 'historico').set('de', de).set('ate', ate);
    return this.http.get<DeliveryAtendimento[]>(`${API_BASE}/delivery`, { params });
  }

  resumo(de: string, ate: string): Observable<DeliveryResumo> {
    const params = new HttpParams().set('id_condominio', this.idCondominio).set('de', de).set('ate', ate);
    return this.http.get<DeliveryResumo>(`${API_BASE}/delivery/resumo`, { params });
  }

  atualizarStatus(
    id: number,
    status: DeliveryStatus,
    options: { motivo?: string; observacao?: string; id_entregador?: number } = {},
  ): Observable<DeliveryAtendimento> {
    return this.http.patch<DeliveryAtendimento>(`${API_BASE}/delivery/${id}`, { status, ...options });
  }

  listEntregadores(busca?: string): Observable<DeliveryEntregador[]> {
    let params = new HttpParams().set('id_condominio', this.idCondominio);
    if (busca?.trim()) params = params.set('busca', busca.trim());
    return this.http.get<DeliveryEntregador[]>(`${API_BASE}/delivery/entregadores`, { params });
  }

  criarEntregador(dto: CriarEntregadorDelivery): Observable<DeliveryEntregador> {
    return this.http.post<DeliveryEntregador>(`${API_BASE}/delivery/entregadores`, {
      ...dto,
      id_condominio: this.idCondominio,
    });
  }

  atualizarEntregador(
    id: number,
    dto: AtualizarEntregadorDelivery,
  ): Observable<DeliveryEntregador> {
    return this.http.patch<DeliveryEntregador>(`${API_BASE}/delivery/entregadores/${id}`, dto);
  }
}
