import { Injectable, inject, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AuthService } from '../auth/auth.service';
import { REALTIME_ORIGIN } from './api.config';

type Ouvinte = (dados: any) => void;

/**
 * Conexão WebSocket para eventos em tempo real (autorização remota de visitante e o interfone pelo app — ver
 * RealtimeGateway no backend).
 *
 * Telas comuns: PURAMENTE ADITIVO. As telas que usam este serviço mantêm o polling existente como rede de segurança
 * — o socket só acelera a atualização quando consegue conectar, nunca é a única fonte da verdade.
 *
 * Interfone: o toque da chamada transferida para a portaria chega só por aqui (`interfone:chamada`/`interfone:fim`).
 * Por isso há `on()`, um ouvinte persistente: fica registrado em qualquer socket novo e, enquanto existir, o
 * `disconnect()` de uma tela (visitantes) não derruba o socket. `conectado` mostra ao painel quando a conexão caiu
 * ("Você não vai receber chamadas do interfone").
 *
 * O socket conecta direto na origem da API (REALTIME_ORIGIN), sem passar pelo
 * rewrite da Vercel: confirmado em 04/09/2026 que o rewrite devolve o
 * index.html do SPA no handshake e não faz upgrade de WebSocket, o que deixava
 * o cliente num loop de reconexão e enchia o console de erro.
 *
 * Token: lido a cada (re)conexão. Quando a sessão troca de token sem sair (troca de senha, troca de condomínio),
 * o socket reconecta com o novo — o antigo a API derruba (a revogação é conferida também no socket) — mantendo o
 * mesmo objeto e os listeners que as telas já registraram.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private socket: Socket | null = null;
  private readonly ouvintes = new Map<string, Set<Ouvinte>>();

  /** O socket está conectado agora. Gravado pelos eventos do próprio socket (fora de evento do Angular). */
  readonly conectado = signal(false);

  constructor() {
    this.auth.tokenRenovado$.subscribe(() => this.reconectar());
  }

  connect(): Socket | null {
    // `active`: ainda tentando (re)conectar sozinho. Criar outro deixaria os ouvintes no socket velho.
    if (this.socket && (this.socket.connected || this.socket.active)) return this.socket;
    const token = this.auth.token;
    if (!token) return null;

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
    for (const [evento, lista] of this.ouvintes) {
      for (const cb of lista) socket.on(evento, cb);
    }
    return socket;
  }

  /**
   * Ouvinte persistente: conecta se preciso, entra em todo socket novo e segura a conexão aberta. Devolve a função
   * que o tira (chamar no ngOnDestroy / ao parar).
   */
  on(evento: string, cb: Ouvinte): () => void {
    let lista = this.ouvintes.get(evento);
    if (!lista) {
      lista = new Set();
      this.ouvintes.set(evento, lista);
    }
    lista.add(cb);
    const novo = !this.socket || !(this.socket.connected || this.socket.active);
    const socket = this.connect();
    // Socket novo já recebeu o ouvinte em connect(); no reaproveitado, registra agora.
    if (socket && !novo) socket.on(evento, cb);
    return () => {
      const atual = this.ouvintes.get(evento);
      atual?.delete(cb);
      if (atual && atual.size === 0) this.ouvintes.delete(evento);
      this.socket?.off(evento, cb);
    };
  }

  /** Reconecta o socket aberto com o token atual da sessão. Sem socket, nada a fazer. */
  reconectar() {
    if (!this.socket || !this.auth.token) return;
    this.socket.disconnect();
    this.socket.connect();
  }

  /** Fecha o socket — a menos que um ouvinte persistente (o interfone) ainda precise dele. */
  disconnect() {
    if (this.ouvintes.size > 0) return;
    this.socket?.disconnect();
    this.socket = null;
    this.conectado.set(false);
  }
}
