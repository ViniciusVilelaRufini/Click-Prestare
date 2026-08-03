import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/jwt-payload.interface';

/**
 * Gateway WebSocket para eventos em tempo real do portaria-web — hoje só a
 * autorização remota de visitante (era o polling mais agressivo, 3s).
 *
 * IMPORTANTE — assume UMA réplica da API: as salas (`condominio:<id>`) vivem
 * em memória do processo Socket.IO. Se o Railway rodar mais de uma instância
 * desta API, um evento emitido na réplica A não chega a um cliente conectado
 * na réplica B — precisaria de um adapter Redis (@socket.io/redis-adapter)
 * para propagar entre instâncias. Não confirmado no momento da implementação
 * (ver conversa/commit) — checar no painel do Railway antes de escalar
 * réplicas > 1 em produção.
 *
 * Autenticação: o token JWT do portaria-web (mesmo usado no header
 * Authorization das chamadas REST) é enviado no handshake
 * (`io(url, { auth: { token } })`). Só tokens com `id_condominio` fixo
 * (porteiro/síndico logado no console) conseguem conectar — é o mesmo
 * requisito que `assertOperador` já exige nas rotas REST equivalentes.
 */
@WebSocketGateway({
  path: '/api/socket.io',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.['token'] as string | undefined) ??
        (client.handshake.query?.['token'] as string | undefined);
      if (!token) throw new Error('sem token');

      const payload = this.jwt.verify<JwtPayload>(token);
      const idCondominio = payload?.id_condominio;
      if (!idCondominio) throw new Error('token sem id_condominio (console apenas)');

      client.join(`condominio:${idCondominio}`);
    } catch (err: any) {
      this.logger.warn(`Conexão WS recusada: ${err?.message ?? err}`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // Nada a limpar: socket.io já remove o client das rooms sozinho.
  }

  emitToCondominio(idCondominio: number, event: string, payload: unknown) {
    this.server?.to(`condominio:${idCondominio}`).emit(event, payload);
  }
}
