import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export type EncomendaStatus = 'Aguardando' | 'Retirada' | 'Esperando';

export interface Encomenda {
  id: number;
  descricao: string;
  destinatario_apto: string;
  destinatario_bloco: string | null;
  recebido_de: string | null;
  recebido_em: string;
  retirado_em: string | null;
  retirado_por: string | null;
  retirado_doc?: string | null;
  retirado_assinatura?: string | null;
  retirado_foto?: string | null;
  status: EncomendaStatus;
  notificado?: number | null;
  notificado_em?: string | null;
  codigo_rastreio?: string | null;
  codigo_validacao?: string | null;
}

export interface CreateEncomenda {
  descricao: string;
  destinatario_apto: string;
  destinatario_bloco?: string;
  recebido_de?: string;
  codigo_rastreio?: string;
}

@Injectable({ providedIn: 'root' })
export class EncomendasApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/encomendas`;
  }

  list(status?: string): Observable<Encomenda[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);

    return this.http.get<Encomenda[]>(this.base, { params });
  }

  create(dto: CreateEncomenda): Observable<Encomenda> {
    return this.http.post<Encomenda>(this.base, dto);
  }

  retirar(
    id: number,
    retiradoPor: string,
    retiradoDoc?: string,
    retiradoAssinatura?: string,
    retiradoFoto?: string,
  ): Observable<Encomenda> {
    return this.http.patch<Encomenda>(`${this.base}/${id}/retirar`, {
      retirado_por: retiradoPor,
      retirado_doc: retiradoDoc,
      retirado_assinatura: retiradoAssinatura,
      retirado_foto: retiradoFoto,
    });
  }

  notificar(id: number): Observable<Encomenda> {
    return this.http.patch<Encomenda>(`${this.base}/${id}/notificar`, {});
  }

  /** Confirma o recebimento de uma encomenda pré-registrada ('Esperando' -> 'Aguardando'). */
  receber(id: number): Observable<Encomenda> {
    return this.http.patch<Encomenda>(`${this.base}/${id}/receber`, {});
  }

  remove(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }
}
