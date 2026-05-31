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

  listLancamentos(mes: string, ano: string): Observable<any> {
    const url = `${API_BASE}/financeiro/get-all?id_condominio=${this.cid}&mes=${mes}&ano=${ano}`;
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

  insertLancamento(payload: any): Observable<any> {
    const url = `${API_BASE}/financeiro/insert`;
    return this.http.post(url, { id_condominio: this.cid, financeiro: payload });
  }

  updateStatus(
    id: number,
    status: string | number,
    extras?: { motivo?: string; formaPagamento?: string; identificadorComprovante?: string },
  ): Observable<any> {
    const url = `${API_BASE}/financeiro/update-status`;
    return this.http.post(url, { id, status, ...extras });
  }

  uploadSharedFile(id: number, fileBase64: string, type: string): Observable<any> {
    const url = `${API_BASE}/financeiro/upload-shared-file`;
    return this.http.post(url, { id, file: fileBase64, type });
  }

  importarOfx(ofxContent: string): Observable<any> {
    const url = `${API_BASE}/financeiro/conciliacao/importar`;
    return this.http.post<any>(url, { id_condominio: this.cid, ofxContent });
  }

  confirmarConciliacao(reconciliations: { databaseId: number; dataPagamento: string }[]): Observable<any> {
    const url = `${API_BASE}/financeiro/conciliacao/confirmar`;
    return this.http.post<any>(url, { id_condominio: this.cid, reconciliations });
  }

  exportCsv(mes: string, ano: string): Observable<Blob> {
    const url = `${API_BASE}/financeiro/export-csv?id_condominio=${this.cid}&mes=${mes}&ano=${ano}`;
    return this.http.get(url, { responseType: 'blob' });
  }

  // ============ Fechamento Mensal ============

  listarFechamentos(): Observable<Fechamento[]> {
    const url = `${API_BASE}/financeiro/fechamentos?id_condominio=${this.cid}`;
    return this.http.get<Fechamento[]>(url);
  }

  fecharMes(mes: number, ano: number, observacao?: string): Observable<any> {
    const url = `${API_BASE}/financeiro/fechamentos/fechar`;
    return this.http.post(url, { id_condominio: this.cid, mes, ano, observacao });
  }

  reabrirMes(mes: number, ano: number, motivo: string): Observable<any> {
    const url = `${API_BASE}/financeiro/fechamentos/reabrir`;
    return this.http.post(url, { id_condominio: this.cid, mes, ano, motivo });
  }
}

export interface Fechamento {
  id: number;
  id_condominio: number;
  mes: number;
  ano: number;
  fechado_em: string;
  fechado_por: string;
  observacao: string | null;
  reaberto_em: string | null;
  reaberto_por: string | null;
  motivo_reabertura: string | null;
  ativo: number;
}
