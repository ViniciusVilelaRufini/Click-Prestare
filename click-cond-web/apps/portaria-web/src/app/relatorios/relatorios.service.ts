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

  getAuditoria(modulo?: string, dataInicio?: string, dataFim?: string): Observable<any[]> {
    let params = new HttpParams();
    if (modulo && modulo !== 'todos') params = params.set('modulo', modulo);
    if (dataInicio) params = params.set('dataInicio', dataInicio);
    if (dataFim) params = params.set('dataFim', dataFim);
    return this.http.get<any[]>(`${this.base}/auditoria`, { params });
  }
}
