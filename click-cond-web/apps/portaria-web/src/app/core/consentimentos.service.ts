import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface RegistrarConsentimentoTerceiroDto {
  tipoPessoa: 'visitante' | 'prestador';
  idPessoa: number;
  doc?: string;
  biometria: boolean;
  maiorIdade: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConsentimentosApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get idCondominio(): number {
    return this.auth.porteiroInfo()?.id_condominio ?? 1;
  }

  registrarTerceiro(dados: RegistrarConsentimentoTerceiroDto): Observable<any> {
    return this.http.post(
      `${API_BASE}/condominios/${this.idCondominio}/consentimentos/terceiros`,
      dados,
    );
  }

  statusTerceiro(tipoPessoa: 'visitante' | 'prestador', idPessoa: number, doc?: string): Observable<any> {
    const params: any = { tipoPessoa, idPessoa };
    if (doc) params.doc = doc;
    return this.http.get(
      `${API_BASE}/condominios/${this.idCondominio}/consentimentos/terceiros/status`,
      { params },
    );
  }

  revogarBiometriaMorador(idMorador: number): Observable<{ ok: boolean; status?: string; message?: string }> {
    return this.http.post<{ ok: boolean; status?: string; message?: string }>(
      `${API_BASE}/condominios/${this.idCondominio}/moradores/${idMorador}/revogar-biometria`,
      {},
    );
  }
}
