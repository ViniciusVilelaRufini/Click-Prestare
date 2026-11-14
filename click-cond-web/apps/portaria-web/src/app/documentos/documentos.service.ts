import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface DocumentoItem {
  id: number;
  nome: string;
  link_doc: string;
}

@Injectable({ providedIn: 'root' })
export class DocumentosApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get cid() {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  listDocumentos(isAta: boolean): Observable<DocumentoItem[]> {
    const isAtaStr = isAta ? '1' : '0';
    const url = `${API_BASE}/documentos/get-all?id_condominio=${this.cid}&is_ata=${isAtaStr}`;
    // Sem fallback: o erro antes virava uma lista de documentos inventados.
    return this.http.get<DocumentoItem[]>(url);
  }

  insertDocumento(nome: string, isAta: boolean, docBase64: string): Observable<any> {
    const url = `${API_BASE}/documentos/insert`;
    const payload = {
      nome,
      is_ata: isAta ? 1 : 0,
      doc: docBase64,
    };
    return this.http.post(url, { id_condominio: this.cid, documento: payload });
  }

  removeDocumento(id: number): Observable<any> {
    const url = `${API_BASE}/documentos/remove`;
    return this.http.post(url, { id });
  }
}
