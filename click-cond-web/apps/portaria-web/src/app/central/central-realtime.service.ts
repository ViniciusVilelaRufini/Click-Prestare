import { Injectable, inject, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { REALTIME_ORIGIN } from '../shared/api.config';
import { CentralAuthService } from './central-auth.service';

type Ouvinte = (dados: any) => void;

/**
 * Tempo real da Central: socket próprio com o `central_token` (o servidor põe o operador na sala `central`).
 * Separado do RealtimeService do porteiro: as duas sessões podem estar abertas no mesmo navegador.
 *
 * Eventos: `interfone:chamada`, `interfone:fim`, `interfone:pedido`, `alerta:novo` (e `connect`, a cada
 * reconexão — o store recarrega a fila). O token é lido a cada (re)conexão; token com `trocar_senha` o servidor
 * recusa, então a troca de senha (tokenRenovado$) reconecta o mesmo socket com o token novo, mantendo os ouvintes.
 */
@Injectable({ providedIn: 'root' })
export class CentralRealtimeService {
  private readonly auth = inject(CentralAuthService);
  private socket: Socket | null = null;
  private readonly ouvintes = new Map<string, Set<Ouvinte>>();

  /** Conectado agora. Gravado pelos eventos do socket (fora de evento do Angular). */
  readonly conectado = signal(false);

  constructor() {
    this.auth.tokenRenovado$.subscribe(() => this.reconectar());
  }

  /** Ouvinte persistente: conecta se preciso e entra em todo socket novo. Devolve a função que o tira. */
  on(evento: string, cb: Ouvinte): () => void {
    let lista = this.ouvintes.get(evento);
    if (!lista) {
      lista = new Set();
      this.ouvintes.set(evento, lista);
    }
    lista.add(cb);
    const novo = !this.socket || !(this.socket.connected || this.socket.active);
    const socket = this.conectar();
    if (socket && !novo) socket.on(evento, cb);
    return () => {
      this.ouvintes.get(evento)?.delete(cb);
      if (this.ouvintes.get(evento)?.size === 0) this.ouvintes.delete(evento);
      this.socket?.off(evento, cb);
    };
  }

  /** Reconecta o socket aberto com o token atual (troca de senha). Sem socket, nada a fazer. */
  reconectar(): void {
    if (!this.socket || !this.auth.token) return;
    this.socket.disconnect();
    this.socket.connect();
  }

  /** Fecha o socket e esquece os ouvintes (saída da área Central). */
  desconectar(): void {
    this.ouvintes.clear();
    this.socket?.disconnect();
    this.socket = null;
    this.conectado.set(false);
  }

  private conectar(): Socket | null {
    if (this.socket && (this.socket.connected || this.socket.active)) return this.socket;
    if (!this.auth.token) return null;
    const socket = io(REALTIME_ORIGIN, {
      path: '/api/socket.io',
      auth: (cb: (dados: object) => void) => cb({ token: this.auth.token }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
    });
    this.socket = socket;
    this.conectado.set(!!socket.connected);
    socket.on('connect', () => this.conectado.set(true));
    socket.on('disconnect', () => this.conectado.set(false));
    socket.on('connect_error', () => this.conectado.set(false));
    for (const [evento, lista] of this.ouvintes) for (const cb of lista) socket.on(evento, cb);
    return socket;
  }
}
