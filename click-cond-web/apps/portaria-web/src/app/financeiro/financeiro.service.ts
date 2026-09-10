import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Lancamento {
  id: number;
  nome: string;
  tipo: string; // 'C' ou 'D'
  valor: number;
  valorString: string;
  saldoString: string;
  categoria: string;
  nome_operador?: string;
  pago: number;
  status?: string;
  url_boleto?: string;
  url_comprovante?: string;
  /**
   * Procedência do lançamento. `'superlogica'` significa espelho do ERP:
   * somente leitura no Clique, então a tela troca os botões de baixa/remoção
   * por um selo — o backend recusaria a ação.
   */
  origem?: string | null;
}

export interface GraficoCategoria {
  categoria: string;
  saldo: number;
  saldoReal: string;
  tipo: string;
  percentualString: string;
}

@Injectable({ providedIn: 'root' })
export class FinanceiroApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get cid() {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  listLancamentos(mes: string, ano: string, incluirTaxasCondominiais = false): Observable<any> {
    let url = `${API_BASE}/financeiro/get-all?id_condominio=${this.cid}&mes=${mes}&ano=${ano}`;
    if (incluirTaxasCondominiais) url += '&incluirTaxasCondominiais=true';
    return this.http.get<any>(url);
  }

  listInadimplentes(): Observable<any> {
    const url = `${API_BASE}/financeiro/inadimplentes/get-all?id_condominio=${this.cid}`;
    return this.http.get<any>(url);
  }

  getInadimplenteDetail(apto: string, bloco: string): Observable<any> {
    const url = `${API_BASE}/financeiro/inadimplente/get?id_condominio=${this.cid}&apto=${apto}&bloco=${bloco}`;
    return this.http.get<any>(url);
  }

  notifyInadimplente(apto: string, bloco: string): Observable<any> {
    const url = `${API_BASE}/financeiro/inadimplente/notificar`;
    return this.http.post<any>(url, { id_condominio: this.cid, apto, bloco });
  }

  getGrafico(mes: string, ano: string): Observable<any> {
    const url = `${API_BASE}/financeiro/grafico/get-all?id_condominio=${this.cid}&mes=${mes}&ano=${ano}`;
    return this.http.get<any>(url);
  }

  exportCsv(mes: string, ano: string, incluirTaxasCondominiais = false): Observable<Blob> {
    let url = `${API_BASE}/financeiro/export-csv?id_condominio=${this.cid}&mes=${mes}&ano=${ano}`;
    if (incluirTaxasCondominiais) url += '&incluirTaxasCondominiais=true';
    return this.http.get(url, { responseType: 'blob' });
  }
}
