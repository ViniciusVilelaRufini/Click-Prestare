import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

/** Condomínio e se tem o módulo "Interfone pelo app" contratado. */
export interface ClienteInterfone {
  id: number;
  nome: string;
  contratado: boolean;
}

/**
 * Interruptor comercial do módulo Interfone pelo app (`Condominios.interfone_contratado`), no mesmo padrão do
 * envio de moradores da Superlógica. Contratado, o síndico vê a aba Interfone no console e liga/desliga lá.
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
}
