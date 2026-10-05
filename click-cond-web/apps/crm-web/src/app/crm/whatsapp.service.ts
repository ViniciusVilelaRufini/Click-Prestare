import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { AuthService } from '../auth/auth.service';

export interface Conversa {
  id: number; waId: string; nome: string; leadId: number | null; ultimaMsgEm: string;
  ultimaDoClienteEm: string | null; naoLidas: number; trecho: string; janelaAberta: boolean;
}
export interface Mensagem {
  id: number;
  direcao: 'entrada' | 'saida';
  tipo: string;
  texto: string;
  status: string;
  erro: string | null;
  criadoEm: string;
  mediaChave?: string | null;
  mediaMime?: string | null;
  mediaNome?: string | null;
  mediaTamanho?: number | null;
  mediaStatus?: string | null;
}
export interface Resposta { id: number; atalho: string; titulo: string; texto: string; ordem: number }
export interface Automacoes {
  boasVindas: { ativo: boolean; texto: string };
  foraHorario: { ativo: boolean; texto: string; dias: number[]; inicio: string; fim: string };
}

@Injectable({ providedIn: 'root' })
export class WhatsappApi {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private base = `${API_BASE}/crm/whatsapp`;

  conversas(): Observable<Conversa[]> { return this.http.get<Conversa[]>(`${this.base}/conversas`); }
  mensagens(id: number): Observable<Mensagem[]> { return this.http.get<Mensagem[]>(`${this.base}/conversas/${id}/mensagens`); }
  enviar(id: number, texto: string): Observable<Mensagem> { return this.http.post<Mensagem>(`${this.base}/conversas/${id}/mensagens`, { texto }); }
  enviarMidia(id: number, arquivo: File, legenda?: string): Observable<Mensagem> {
    const form = new FormData();
    form.append('arquivo', arquivo, arquivo.name);
    let tipo: 'image' | 'video' | 'document' = 'document';
    if (arquivo.type.startsWith('image/')) tipo = 'image';
    else if (arquivo.type.startsWith('video/')) tipo = 'video';
    form.append('tipo', tipo);
    if (legenda && legenda.trim()) form.append('legenda', legenda.trim());
    return this.http.post<Mensagem>(`${this.base}/conversas/${id}/midias`, form);
  }
  urlMidia(id: number): string {
    const token = this.auth.token;
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${this.base}/midias/${id}${qs}`;
  }
  iniciarConversa(leadId: number): Observable<{ conversaId: number; mensagem: Mensagem }> {
    return this.http.post<{ conversaId: number; mensagem: Mensagem }>(`${this.base}/leads/${leadId}/iniciar`, {});
  }
  novoContato(c: { nome: string; telefone: string; condominio?: string }): Observable<{ conversaId: number; mensagem: Mensagem | null }> {
    return this.http.post<{ conversaId: number; mensagem: Mensagem | null }>(`${this.base}/contatos`, c);
  }
  naoLidas(): Observable<{ total: number }> { return this.http.get<{ total: number }>(`${this.base}/nao-lidas`); }

  respostas(): Observable<Resposta[]> { return this.http.get<Resposta[]>(`${this.base}/respostas`); }
  criarResposta(r: Omit<Resposta, 'id'>): Observable<Resposta> { return this.http.post<Resposta>(`${this.base}/respostas`, r); }
  editarResposta(id: number, r: Omit<Resposta, 'id'>): Observable<Resposta> { return this.http.put<Resposta>(`${this.base}/respostas/${id}`, r); }
  excluirResposta(id: number): Observable<void> { return this.http.delete<void>(`${this.base}/respostas/${id}`); }

  automacoes(): Observable<Automacoes> { return this.http.get<Automacoes>(`${this.base}/automacoes`); }
  salvarAutomacoes(a: Automacoes): Observable<Automacoes> { return this.http.put<Automacoes>(`${this.base}/automacoes`, a); }
}
