import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

/** Condomínio, se tem o módulo "Interfone pelo app" contratado e a configuração da central Prestare. */
export interface ClienteInterfone {
  id: number;
  nome: string;
  contratado: boolean;
  central_contratada: boolean;
  ia_portao_ativa: boolean;
  /** Número que o visitante digita no facial para chamar a portaria (padrão "0"). */
  numero_portaria: string;
  instrucao_entregas: string | null;
}

export type DestinoPortaria = 'local' | 'central';

/** Faixa da agenda da portaria: 0 = domingo; fim pode ser "24:00". */
export interface FaixaAgenda {
  dia_semana: number;
  inicio: string;
  fim: string;
  destino: DestinoPortaria;
}

/** Operador da central como o CRM vê (nunca senha nem hash). */
export interface OperadorCentral {
  id: number;
  nome: string;
  email: string;
  ativo: boolean;
  trocar_senha: boolean;
  ultimo_acesso: string | null;
  created_at: string;
}

/**
 * Interruptor comercial do módulo Interfone pelo app (`Condominios.interfone_contratado`), no mesmo padrão do
 * envio de moradores da Superlógica. Contratado, o síndico vê a aba Interfone no console e liga/desliga lá.
 * Portaria autônoma: central contratada, IA no portão, número da portaria, instruções de entrega e agenda.
 */
@Injectable({ providedIn: 'root' })
export class InterfoneCrmApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE}/crm/interfone`;

  clientes(): Observable<ClienteInterfone[]> {
    return this.http.get<ClienteInterfone[]>(`${this.base}/clientes`);
  }

  definirContratado(idCliente: number, ligado: boolean): Observable<{ ok?: boolean; contratado?: boolean }> {
    return this.http.post<{ ok?: boolean; contratado?: boolean }>(`${this.base}/clientes/${idCliente}/contratado`, {
      ligado,
    });
  }

  definirCentral(idCliente: number, ligado: boolean): Observable<{ id: number; central_contratada: boolean }> {
    return this.http.post<{ id: number; central_contratada: boolean }>(`${this.base}/clientes/${idCliente}/central`, { ligado });
  }

  definirIa(idCliente: number, ligado: boolean): Observable<{ id: number; ia_portao_ativa: boolean }> {
    return this.http.post<{ id: number; ia_portao_ativa: boolean }>(`${this.base}/clientes/${idCliente}/ia`, { ligado });
  }

  salvarPortaria(
    idCliente: number,
    dados: { numero_portaria: string; instrucao_entregas: string | null },
  ): Observable<{ id: number; numero_portaria: string; instrucao_entregas: string | null }> {
    return this.http.put<{ id: number; numero_portaria: string; instrucao_entregas: string | null }>(
      `${this.base}/clientes/${idCliente}/portaria`,
      dados,
    );
  }

  agenda(idCliente: number): Observable<FaixaAgenda[]> {
    return this.http.get<FaixaAgenda[]>(`${this.base}/clientes/${idCliente}/agenda`);
  }

  salvarAgenda(idCliente: number, faixas: FaixaAgenda[]): Observable<FaixaAgenda[]> {
    return this.http.put<FaixaAgenda[]>(`${this.base}/clientes/${idCliente}/agenda`, faixas);
  }
}

/** Cadastro dos operadores da central Prestare (aba "Operadores da central"). */
@Injectable({ providedIn: 'root' })
export class CentralOperadoresApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE}/crm/central/operadores`;

  listar(): Observable<OperadorCentral[]> {
    return this.http.get<OperadorCentral[]>(this.base);
  }

  criar(dados: { nome: string; email: string }): Observable<{ id: number; senha_temporaria: string }> {
    return this.http.post<{ id: number; senha_temporaria: string }>(this.base, dados);
  }

  definirAtivo(id: number, ligado: boolean): Observable<{ id: number; ativo: boolean }> {
    return this.http.post<{ id: number; ativo: boolean }>(`${this.base}/${id}/ativo`, { ligado });
  }

  novaSenha(id: number): Observable<{ senha_temporaria: string }> {
    return this.http.post<{ senha_temporaria: string }>(`${this.base}/${id}/nova-senha`, {});
  }
}
