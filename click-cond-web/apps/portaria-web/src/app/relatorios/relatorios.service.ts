import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

@Injectable({ providedIn: 'root' })
export class RelatoriosApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get base() {
    const cid = this.auth.porteiroInfo()?.id_condominio ?? 1;
    return `${API_BASE}/condominios/${cid}/relatorios`;
  }

  downloadReport(tipo: string, formato: string, dataInicio?: string, dataFim?: string): Observable<Blob> {
    let params = new HttpParams()
      .set('tipo', tipo)
      .set('formato', formato);

    if (dataInicio) params = params.set('dataInicio', dataInicio);
    if (dataFim) params = params.set('dataFim', dataFim);

    return this.http.get(this.base, {
      params,
      responseType: 'blob',
    });
  }

  getAuditoria(
    modulo?: string,
    dataInicio?: string,
    dataFim?: string,
    page = 1,
    pageSize = 50,
  ): Observable<AuditoriaPage> {
    let params = new HttpParams()
      .set('page', String(page))
      .set('pageSize', String(pageSize));
    if (modulo && modulo !== 'todos') params = params.set('modulo', modulo);
    if (dataInicio) params = params.set('dataInicio', dataInicio);
    if (dataFim) params = params.set('dataFim', dataFim);
    return this.http.get<AuditoriaPage>(`${this.base}/auditoria`, { params });
  }

  exportAuditoria(modulo?: string, dataInicio?: string, dataFim?: string): Observable<Blob> {
    let params = new HttpParams();
    if (modulo && modulo !== 'todos') params = params.set('modulo', modulo);
    if (dataInicio) params = params.set('dataInicio', dataInicio);
    if (dataFim) params = params.set('dataFim', dataFim);
    return this.http.get(`${this.base}/auditoria/export`, { params, responseType: 'blob' });
  }

  getEventos(
    dataInicio?: string,
    dataFim?: string,
    page = 1,
    pageSize = 50,
    search?: string,
  ): Observable<EventosPage> {
    let params = new HttpParams()
      .set('page', String(page))
      .set('pageSize', String(pageSize));
    if (dataInicio) params = params.set('dataInicio', dataInicio);
    if (dataFim) params = params.set('dataFim', dataFim);
    if (search) params = params.set('search', search);
    return this.http.get<EventosPage>(`${this.base}/eventos`, { params });
  }
}

export interface AuditoriaPage {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EventosPage {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
}
