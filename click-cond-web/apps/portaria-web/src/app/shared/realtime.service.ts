import { Injectable, inject } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AuthService } from '../auth/auth.service';
import { REALTIME_ORIGIN } from './api.config';

/**
 * Conexão WebSocket para eventos em tempo real (hoje só autorização remota
 * de visitante — ver RealtimeGateway no backend).
 *
 * PURAMENTE ADITIVO: nenhuma tela deve depender só disto. As telas que usam
 * este serviço mantêm o polling existente como rede de segurança — o socket
 * só acelera a atualização quando consegue conectar, nunca é a única fonte
 * da verdade.
 *
 * O socket conecta direto na origem da API (REALTIME_ORIGIN), sem passar pelo
 * rewrite da Vercel: confirmado em 04/09/2026 que o rewrite devolve o
 * index.html do SPA no handshake e não faz upgrade de WebSocket, o que deixava
 * o cliente num loop de reconexão e enchia o console de erro.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private socket: Socket | null = null;

  connect(): Socket | null {
    if (this.socket?.connected) return this.socket;
    const token = this.auth.token;
    if (!token) return null;

    this.socket = io(REALTIME_ORIGIN, {
      path: '/api/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
    });
    return this.socket;
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
