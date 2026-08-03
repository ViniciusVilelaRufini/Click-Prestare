import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Vaga {
  id: number | null;
  tipo_ocupacao: 'proprio' | 'visitante' | 'inquilino';
  id_morador_titular: number | null;
  id_veiculo: number | null;
  id_visitante: number | null;
  id_morador_beneficiario: number | null;
  placa: string | null;
  inicio: string | null;
  fim: string | null;
  titular_nome: string | null;
  ocupante_nome: string | null;
}

export interface VagasResumo {
  qtd_vagas: number;
  ocupadas: number;
  vagas: Vaga[];
  moradores: { id: number; nome: string; tipo: string | null }[];
}

export interface VagaBeneficiarios {
  visitantes: { id: number; nome: string; doc_identificacao: string | null; tem_foto: boolean }[];
  inquilinos: { id: number; nome: string }[];
}

@Injectable({ providedIn: 'root' })
export class VagasApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get cid() {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  private base(idApartamento: number) {
    return `${API_BASE}/condominios/${this.cid}/apartamentos/${idApartamento}/vagas`;
  }

  list(idApartamento: number): Observable<VagasResumo> {
    return this.http.get<VagasResumo>(this.base(idApartamento));
  }

  beneficiarios(idApartamento: number): Observable<VagaBeneficiarios> {
    return this.http.get<VagaBeneficiarios>(`${this.base(idApartamento)}/beneficiarios`);
  }

  liberar(idApartamento: number, dto: {
    id_morador_titular: number;
    tipo: 'visitante' | 'inquilino';
    id_visitante?: number;
    id_morador_beneficiario?: number;
    placa?: string;
    inicio?: string;
    fim?: string;
  }): Observable<Vaga> {
    return this.http.post<Vaga>(`${this.base(idApartamento)}/liberar`, dto);
  }

  revogar(idApartamento: number, id: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.base(idApartamento)}/${id}/revogar`, {});
  }
}
