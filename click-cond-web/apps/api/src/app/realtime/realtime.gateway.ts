import { Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { JwtStrategy } from '../auth/jwt.strategy';

/** De quanto em quanto tempo as conexões abertas são reconferidas contra a revogação da sessão. */
const RECONFERIR_MS = 60_000;

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
 *
 * Revogação: a conexão passa pela mesma regra do JwtStrategy das rotas REST (porteiro removido, desativado ou
 * com a credencial trocada; síndico/QR sem vínculo; senha trocada). Antes era só jwt.verify, e quem perdia o
 * acesso seguia recebendo os eventos do condomínio. As conexões abertas são reconferidas a cada RECONFERIR_MS,
 * e o token vencido também cai.
 */
@WebSocketGateway({
  path: '/api/socket.io',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private timer?: ReturnType<typeof setInterval>;
  private strategy: JwtStrategy | null = null;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  afterInit() {
    this.timer = setInterval(() => void this.reconferirConexoes(), RECONFERIR_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** O JwtStrategy do AuthModule, sem importar o módulo (este é global e os serviços do AuthModule usam o gateway). */
  private estrategia(): JwtStrategy | null {
    if (this.strategy) return this.strategy;
    // Não achou: registra o erro e tenta de novo na próxima conexão. Antes o nulo ficava guardado para sempre, e o
    // socket seguia só com jwt.verify até o processo reiniciar.
    let erro = 'sem ModuleRef';
    try {
      this.strategy = this.moduleRef?.get(JwtStrategy, { strict: false }) ?? null;
    } catch (err: any) {
      this.strategy = null;
      erro = err?.message ?? String(err);
    }
    if (!this.strategy) this.logger.error(`JwtStrategy indisponível no socket; revogação não conferida (${erro}).`);
    return this.strategy ?? null;
  }

  /** Assinatura, validade e a mesma revogação das rotas REST. Lança se a sessão não vale mais. */
  private async conferir(token: string): Promise<JwtPayload> {
    const payload = this.jwt.verify<JwtPayload>(token);
    const estrategia = this.estrategia();
    if (estrategia) await estrategia.validate(payload as any);
    return payload;
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.['token'] as string | undefined) ??
        (client.handshake.query?.['token'] as string | undefined);
      if (!token) throw new Error('sem token');

      const payload = await this.conferir(token);
      const idCondominio = payload?.id_condominio;
      if (!idCondominio) throw new Error('token sem id_condominio (console apenas)');

      client.data = { ...(client.data ?? {}), token };
      client.join(`condominio:${idCondominio}`);
    } catch (err: any) {
      this.logger.warn(`Conexão WS recusada: ${err?.message ?? err}`);
      client.disconnect(true);
    }
  }

  /** Derruba as conexões abertas cuja sessão foi revogada (ou venceu) depois de conectar. */
  async reconferirConexoes() {
    const sockets: Map<string, Socket> | undefined = (this.server as any)?.sockets?.sockets;
    if (!sockets) return;
    for (const client of sockets.values()) {
      const token = client.data?.token as string | undefined;
      if (!token) continue;
      try {
        await this.conferir(token);
      } catch (err: any) {
        this.logger.warn(`Conexão WS encerrada: ${err?.message ?? err}`);
        client.disconnect(true);
      }
    }
  }

  handleDisconnect() {
    // Nada a limpar: socket.io já remove o client das rooms sozinho.
  }

  emitToCondominio(idCondominio: number, event: string, payload: unknown) {
    this.server?.to(`condominio:${idCondominio}`).emit(event, payload);
  }
}
