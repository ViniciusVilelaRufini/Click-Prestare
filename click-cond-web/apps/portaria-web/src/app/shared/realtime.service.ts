import { Injectable, inject } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { AuthService } from '../auth/auth.service';

/**
 * Conexão WebSocket para eventos em tempo real (hoje só autorização remota
 * de visitante — ver RealtimeGateway no backend).
 *
 * PURAMENTE ADITIVO: nenhuma tela deve depender só disto. O socket conecta na
 * MESMA origem relativa (`/api`) que o resto do app usa pra HTTP — em prod
 * isso passa pelo rewrite do `vercel.json` até o Railway, e rewrites da
 * Vercel para destino externo são pensados para HTTP, não necessariamente
 * para upgrade de WebSocket. Não foi confirmado em produção no momento desta
 * implementação. Por isso as telas que usam este serviço mantêm o polling
 * existente como rede de segurança — o socket só acelera a atualização
 * quando consegue conectar, nunca é a única fonte da verdade.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private socket: Socket | null = null;

  connect(): Socket | null {
    if (this.socket?.connected) return this.socket;
    const token = this.auth.token;
    if (!token) return null;

    this.socket = io(window.location.origin, {
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
