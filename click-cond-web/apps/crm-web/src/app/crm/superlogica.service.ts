import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

/** Condomínio do ERP Superlógica disponível para vínculo. */
export interface CondominioSuperlogica {
  idSuperlogica: number;
  nome: string;
  /** Preenchido quando já está vinculado a um condomínio do Clique. */
  vinculadoA: { id: number; nome: string } | null;
}

/** Condomínio do Clique e o estado do vínculo. */
export interface ClienteVinculo {
  id: number;
  nome: string;
  ativo: boolean;
  idSuperlogica: number | null;
  totalApartamentos: number;
  apartamentosVinculados: number;
  /** Mão dupla: envia morador criado no Clique para o ERP. */
  escrita: boolean;
}

export interface ResultadoImportacao {
  unidadesNoErp: number;
  apartamentosCriados: number;
  apartamentosVinculados: number;
  /** Unidades que colidiriam depois de normalizar — não importadas. */
  duplicadasIgnoradas: string[];
  moradoresCriados: number;
  moradoresJaExistiam: number;
  moradoresSemNome: number;
}

export interface ResultadoSync {
  cobrancasLidas: number;
  lancamentosGravados: number;
  /** Cobranças de unidade que não foi importada. */
  semApartamento: number;
  descartadas: number;
}

export interface PreviewUnidades {
  totalNoErp: number;
  apartamentosNoClique: number;
  amostra: { idSuperlogica: number; bloco: string | null; unidade: string; contatos: number }[];
}

/**
 * Ativação da integração Superlógica. Todas as rotas exigem token de admin do
 * CRM e são somente leitura do lado do ERP — ver INTEGRACAO_SUPERLOGICA.md.
 */
@Injectable({ providedIn: 'root' })
export class SuperlogicaService {
  private http = inject(HttpClient);
  private base = `${API_BASE}/crm/superlogica`;

  status(): Observable<{ configurado: boolean }> {
    return this.http.get<{ configurado: boolean }>(`${this.base}/status`);
  }

  condominiosDoErp(): Observable<CondominioSuperlogica[]> {
    return this.http.get<CondominioSuperlogica[]>(`${this.base}/condominios`);
  }

  clientes(): Observable<ClienteVinculo[]> {
    return this.http.get<ClienteVinculo[]>(`${this.base}/clientes`);
  }

  previewUnidades(idCliente: number): Observable<PreviewUnidades> {
    return this.http.get<PreviewUnidades>(`${this.base}/clientes/${idCliente}/preview-unidades`);
  }

  vincular(idCliente: number, idSuperlogica: number): Observable<{ success: boolean; nomeSuperlogica: string }> {
    return this.http.post<{ success: boolean; nomeSuperlogica: string }>(
      `${this.base}/clientes/${idCliente}/vincular`,
      { idSuperlogica },
    );
  }

  desvincular(idCliente: number): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.base}/clientes/${idCliente}/vincular`);
  }

  /**
   * Cria/vincula os apartamentos a partir das unidades do ERP. Idempotente.
   *
   * `comMoradores` também cria os moradores a partir dos contatos — contas de
   * pessoas reais, então é opção explícita e nunca dispara e-mail.
   */
  importarUnidades(idCliente: number, comMoradores = false): Observable<ResultadoImportacao> {
    return this.http.post<ResultadoImportacao>(
      `${this.base}/clientes/${idCliente}/importar-unidades`,
      { comMoradores },
    );
  }

  /** Roda a sincronização de cobranças agora, sem esperar o ciclo horário. */
  sincronizar(idCliente: number): Observable<ResultadoSync> {
    return this.http.post<ResultadoSync>(`${this.base}/clientes/${idCliente}/sincronizar`, {});
  }

  /** Liga/desliga o envio de moradores do Clique para o ERP. */
  definirEscrita(idCliente: number, ligado: boolean): Observable<{ success: boolean; escrita: boolean }> {
    return this.http.post<{ success: boolean; escrita: boolean }>(
      `${this.base}/clientes/${idCliente}/escrita`,
      { ligado },
    );
  }
}
