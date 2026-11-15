import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Assembleia {
  id: number;
  titulo: string;
  descricao?: string;
  data: string;
  hora: string;
  local?: string;
  link?: string;
  anexos?: string;
}

export interface Votacao {
  id: number;
  titulo: string;
  descricao?: string;
  data_inicio: string;
  data_termino: string;
  status: number; // 0=Agendado, 1=Em andamento, 2=Finalizado
  opcoes: string[]; // "id;nome;votos"
  /** Aberta/agendada: a API zera os votos e manda `true`. Ausente (API antiga) = falso. */
  resultado_oculto?: boolean;
  /** Inquilinos não votam (0/1; ausente = 0). */
  somente_proprietarios?: number | boolean;
  /** Quórum: unidades que votaram / apartamentos do condomínio. Ausente na API antiga. */
  participacao?: { unidades_votaram: number; unidades_total: number } | null;
  encerrada_em?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AssembleiasApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get cid() {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  // ==========================================
  // ASSEMBLEIAS
  // ==========================================
  listAssembleias(): Observable<Assembleia[]> {
    const url = `${API_BASE}/assembleias/get-all?id_condominio=${this.cid}`;
    return this.http.get<Assembleia[]>(url);
  }

  getAssembleia(id: number): Observable<{ assembleia: Assembleia; votacoes: Votacao[]; meusVotos: string[] }> {
    const url = `${API_BASE}/assembleias/get?id_condominio=${this.cid}&id=${id}`;
    return this.http.get<any>(url);
  }

  insertAssembleia(payload: any): Observable<any> {
    const url = `${API_BASE}/assembleias/insert`;
    return this.http.post(url, { id_condominio: this.cid, assembleia: payload });
  }

  updateAssembleia(payload: any): Observable<any> {
    const url = `${API_BASE}/assembleias/update`;
    return this.http.post(url, { id_condominio: this.cid, assembleia: payload });
  }

  removeAssembleia(id: number): Observable<any> {
    const url = `${API_BASE}/assembleias/remove`;
    return this.http.post(url, { id });
  }

  finishAssembleia(assembleia: any): Observable<any> {
    const url = `${API_BASE}/assembleias/finish/insert`;
    return this.http.post(url, { id_condominio: this.cid, assembleia });
  }

  // ==========================================
  // VOTAÇÕES E ENQUETES
  // ==========================================
  insertVotacao(payload: any): Observable<any> {
    const url = `${API_BASE}/assembleias/votacoes/insert`;
    return this.http.post(url, { id_condominio: this.cid, votacao: payload });
  }

  removeVotacao(id: number): Observable<any> {
    const url = `${API_BASE}/assembleias/votacoes/remove`;
    return this.http.post(url, { id });
  }

  finishVotacao(id: number): Observable<any> {
    const url = `${API_BASE}/assembleias/votacoes/finish`;
    return this.http.post(url, { id });
  }

  listEnquetes(): Observable<Votacao[]> {
    const url = `${API_BASE}/assembleias/votacoes/enquetes/get-all?id_condominio=${this.cid}`;
    return this.http.get<Votacao[]>(url);
  }
}
