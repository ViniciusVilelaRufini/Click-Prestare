import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';

export interface Conversa {
  id: number; waId: string; nome: string; leadId: number | null; ultimaMsgEm: string;
  ultimaDoClienteEm: string | null; naoLidas: number; trecho: string; janelaAberta: boolean;
}
export interface Mensagem { id: number; direcao: 'entrada' | 'saida'; texto: string; status: string; erro: string | null; criadoEm: string }

@Injectable({ providedIn: 'root' })
export class WhatsappApi {
  private http = inject(HttpClient);
  private base = `${API_BASE}/crm/whatsapp`;

  conversas(): Observable<Conversa[]> { return this.http.get<Conversa[]>(`${this.base}/conversas`); }
  mensagens(id: number): Observable<Mensagem[]> { return this.http.get<Mensagem[]>(`${this.base}/conversas/${id}/mensagens`); }
  enviar(id: number, texto: string): Observable<Mensagem> { return this.http.post<Mensagem>(`${this.base}/conversas/${id}/mensagens`, { texto }); }
  iniciarConversa(leadId: number): Observable<{ conversaId: number; mensagem: Mensagem }> {
    return this.http.post<{ conversaId: number; mensagem: Mensagem }>(`${this.base}/leads/${leadId}/iniciar`, {});
  }
  naoLidas(): Observable<{ total: number }> { return this.http.get<{ total: number }>(`${this.base}/nao-lidas`); }
}
