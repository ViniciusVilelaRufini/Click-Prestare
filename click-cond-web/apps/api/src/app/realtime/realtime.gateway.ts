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
import { ConferenciaIndisponivelException, JwtStrategy } from '../auth/jwt.strategy';
import { PresencaRedis, RENOVAR_PRESENCA_MS } from './presenca-redis';
import { criarAdaptadorRedis } from './redis-adapter';

/** Prefixo das salas de portaria (vigiadas pela presença entre réplicas). */
const PREFIXO_PORTARIA = 'portaria:';

/** Sala dos porteiros do condomínio (só tokens `tipo_sub === 'funcionario_portaria'`). */
export const salaPortaria = (idCondominio: number) => `${PREFIXO_PORTARIA}${idCondominio}`;

/** Sala dos operadores da central (token com `papel === 'operador_central'`, sem condomínio). */
export const SALA_CENTRAL = 'central';

/** De quanto em quanto tempo as conexões abertas são reconferidas contra a revogação da sessão. */
const RECONFERIR_MS = 60_000;

/**
 * Teto da espera de uma conexão pela decisão do adaptador (o Redis já desiste em 5 s em criarAdaptadorRedis;
 * este é só a rede de segurança para a conexão nunca ficar presa).
 */
const ESPERA_ADAPTADOR_MS = 6_000;

/** Salas cuja ocupação a outra réplica precisa saber (porteirosOnline / centralOnline). */
const salaVigiada = (sala: string) => sala === SALA_CENTRAL || sala.startsWith(PREFIXO_PORTARIA);

/** O token não pôde ser conferido agora (banco/JwtStrategy fora) — não é revogação. */
class SemConferencia extends Error {}

/**
 * Gateway WebSocket para eventos em tempo real do portaria-web — hoje só a
 * autorização remota de visitante (era o polling mais agressivo, 3s).
 *
 * Réplicas: com REDIS_URL definido, as salas passam pelo adaptador Redis sharded
 * (@socket.io/redis-adapter) e um evento emitido numa réplica chega aos
 * clientes de todas. Sem REDIS_URL (ou se o Redis cair na partida) as salas
 * ficam em memória do processo, como antes — vale só com uma réplica.
 * "Há porteiro/operador online?" não usa fetchSockets (no ElastiCache Serverless o remoto volta 0): conta a sala
 * local e, se vazia, a presença que as outras réplicas anunciam no Redis (presenca-redis.ts).
 *
 * Autenticação: o token JWT do portaria-web (mesmo usado no header
 * Authorization das chamadas REST) é enviado no handshake
 * (`io(url, { auth: { token } })`). Só tokens com `id_condominio` fixo
 * (porteiro/síndico logado no console) conseguem conectar — é o mesmo
 * requisito que `assertOperador` já exige nas rotas REST equivalentes. A exceção é o operador da central
 * (`papel: 'operador_central'`, sem condomínio), que entra só na sala `central`.
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
  /**
   * Decisão do adaptador (Redis aplicado ou null = memória). Até ela sair, as conexões esperam para entrar
   * nas salas: o `server.adapter()` do socket.io 4.8 recria o adaptador e as salas de quem entrou antes
   * somem. Undefined = afterInit não rodou (nada a esperar); null = decidido.
   */
  private adaptadorPendente?: Promise<void> | null;
  /** Presença entre réplicas; null = sem Redis (tudo local). */
  private presenca: PresencaRedis | null = null;
  private timerPresenca?: ReturnType<typeof setInterval>;
  /**
   * Salas vigiadas que esta réplica anunciou como ocupadas. No handleDisconnect o socket já saiu das salas, então
   * é por este Set que se sabe o que conferir (sala esvaziou → anúncio inativo).
   */
  private readonly salasAnunciadas = new Set<string>();
  /** Trava da renovação: a rodada seguinte não começa enquanto a anterior não terminou. */
  private renovando = false;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async afterInit(server?: Server) {
    // O timer sobe antes do Redis: a revogação das sessões não pode esperar a conexão.
    this.timer = setInterval(() => void this.reconferirConexoes(), RECONFERIR_MS);
    this.timer.unref?.();
    const alvo = server ?? this.server;
    const decisao = (async () => {
      const redis = await criarAdaptadorRedis(process.env['REDIS_URL']);
      if (redis && alvo) {
        alvo.adapter(redis.adaptador);
        this.presenca = new PresencaRedis(redis.redis);
        this.timerPresenca = setInterval(() => void this.renovarPresenca(), RENOVAR_PRESENCA_MS);
        this.timerPresenca.unref?.();
      }
    })();
    this.adaptadorPendente = decisao.catch(() => undefined);
    try {
      await decisao;
    } finally {
      this.adaptadorPendente = null;
    }
  }

  /** Espera a decisão do adaptador (com teto) antes de entrar nas salas. Nunca lança. */
  private async esperarAdaptador(): Promise<void> {
    const pendente = this.adaptadorPendente;
    if (!pendente) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const teto = new Promise<void>((r) => {
      timer = setTimeout(r, ESPERA_ADAPTADOR_MS);
      timer.unref?.();
    });
    try {
      await Promise.race([pendente, teto]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.timerPresenca) clearInterval(this.timerPresenca);
    this.timerPresenca = undefined;
    // Sai da presença antes de parar (best-effort, teto de 2 s por sala): a outra réplica não espera os 15 s do TTL.
    const presenca = this.presenca;
    if (!presenca) return;
    this.presenca = null;
    const salas = [...this.salasAnunciadas];
    this.salasAnunciadas.clear();
    try {
      await presenca.encerrar(salas);
    } catch (err: any) {
      this.logger.warn(`Presença no encerramento falhou: ${err?.message ?? err}`);
    }
  }

  /** Quantos sockets DESTA réplica estão na sala (as salas do adaptador são sempre locais). */
  private locaisNaSala(sala: string): number {
    return this.server?.of('/')?.adapter?.rooms?.get(sala)?.size ?? 0;
  }

  /** Anuncia a sala vigiada como ocupada nesta réplica, logo depois do join. Nunca lança. */
  private async anunciarEntrada(sala: string): Promise<void> {
    if (!this.presenca || !salaVigiada(sala)) return;
    this.salasAnunciadas.add(sala);
    await this.presenca.anunciar(sala, true);
  }

  /** Tira do Set as salas anunciadas que ficaram sem socket local e devolve os anúncios de saída (em paralelo). */
  private retiradasVazias(presenca: PresencaRedis): Promise<void>[] {
    const saidas: Promise<void>[] = [];
    for (const sala of [...this.salasAnunciadas]) {
      if (this.locaisNaSala(sala) > 0) continue;
      this.salasAnunciadas.delete(sala);
      saidas.push(presenca.anunciar(sala, false));
    }
    return saidas;
  }

  /**
   * Renovação periódica (RENOVAR_PRESENCA_MS): reanuncia toda sala vigiada com socket local — inclusive alguma
   * que o join não anunciou (presença ligada depois, anúncio que falhou) — e retira as que esvaziaram, tudo em
   * paralelo. Uma rodada por vez: com o Redis travado, o timer não empilha comandos. Nunca lança.
   */
  async renovarPresenca(): Promise<void> {
    const presenca = this.presenca;
    if (!presenca || this.renovando) return;
    this.renovando = true;
    try {
      const rooms: Map<string, Set<string>> | undefined = this.server?.of('/')?.adapter?.rooms;
      const comandos: Promise<void>[] = [];
      for (const [sala, ids] of rooms ?? []) {
        if (!salaVigiada(sala) || !ids?.size) continue;
        this.salasAnunciadas.add(sala);
        comandos.push(presenca.anunciar(sala, true));
      }
      comandos.push(...this.retiradasVazias(presenca));
      await Promise.allSettled(comandos);
    } catch (err: any) {
      this.logger.warn(`Renovação da presença falhou: ${err?.message ?? err}`);
    } finally {
      this.renovando = false;
    }
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

  /**
   * Assinatura, validade e a mesma revogação das rotas REST. Lança se a sessão não vale mais; lança
   * SemConferencia quando não deu para conferir (banco fora, JwtStrategy indisponível) — quem decide o que
   * fazer com isso é quem chama (handshake novo recusa; socket já aceito fica).
   */
  private async conferir(token: string): Promise<JwtPayload> {
    const payload = this.jwt.verify<JwtPayload>(token);
    const estrategia = this.estrategia();
    if (estrategia) {
      try {
        await estrategia.validate(payload as any);
      } catch (err) {
        if (err instanceof ConferenciaIndisponivelException) throw new SemConferencia('sessão não conferida (banco indisponível)');
        throw err;
      }
    }
    // O token do operador enxerga vários condomínios: sem a JwtStrategy (ativo + cred), a assinatura
    // sozinha não basta. Fail-closed, ao contrário dos tokens de condomínio.
    else if (payload?.papel === 'operador_central') throw new SemConferencia('operador da central sem conferência de revogação');
    return payload;
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.['token'] as string | undefined) ??
        (client.handshake.query?.['token'] as string | undefined);
      if (!token) throw new Error('sem token');

      const payload = await this.conferir(token);
      // Entra nas salas só no adaptador definitivo (ver adaptadorPendente).
      await this.esperarAdaptador();
      // Caiu durante a espera: join agora deixaria o id órfão nas salas do adaptador.
      if (client.disconnected) return;
      if (payload?.papel === 'operador_central' && !payload?.id_condominio) {
        // Senha temporária ainda não trocada: nenhuma rota da central vale (operadorDoToken), o socket também não.
        if (payload.trocar_senha) throw new Error('operador da central precisa trocar a senha');
        client.data = { ...(client.data ?? {}), token };
        client.join(SALA_CENTRAL);
        await this.anunciarEntrada(SALA_CENTRAL);
        return;
      }
      const idCondominio = payload?.id_condominio;
      if (!idCondominio) throw new Error('token sem id_condominio (console apenas)');

      client.data = { ...(client.data ?? {}), token };
      client.join(`condominio:${idCondominio}`);
      // Interfone: sala só dos porteiros (o síndico no console não atende o
      // interfone). É ela que diz se há "porteiro online" para transferir.
      if (payload?.tipo_sub === 'funcionario_portaria') {
        const sala = salaPortaria(Number(idCondominio));
        client.join(sala);
        await this.anunciarEntrada(sala);
      }
    } catch (err: any) {
      this.logger.warn(`Conexão WS recusada: ${err?.message ?? err}`);
      client.disconnect(true);
    }
  }

  /**
   * Derruba as conexões abertas cuja sessão foi revogada (ou venceu) depois de conectar. "Não deu para
   * conferir" (banco fora) não derruba quem já foi aceito: senão uma queda do banco tirava todos os
   * operadores da central de uma vez; a próxima rodada confere de novo.
   */
  async reconferirConexoes() {
    const sockets: Map<string, Socket> | undefined = (this.server as any)?.sockets?.sockets;
    if (!sockets) return;
    for (const client of sockets.values()) {
      const token = client.data?.token as string | undefined;
      if (!token) continue;
      try {
        await this.conferir(token);
      } catch (err: any) {
        if (err instanceof SemConferencia) {
          this.logger.warn(`Conexão WS mantida sem reconferência: ${err.message}`);
          continue;
        }
        this.logger.warn(`Conexão WS encerrada: ${err?.message ?? err}`);
        client.disconnect(true);
      }
    }
  }

  /** O socket.io já tirou o client das salas; aqui só se retira o anúncio da sala que ficou vazia. Nunca lança. */
  async handleDisconnect(_client?: Socket): Promise<void> {
    const presenca = this.presenca;
    if (!presenca) return;
    try {
      await Promise.allSettled(this.retiradasVazias(presenca));
    } catch (err: any) {
      this.logger.warn(`Presença no disconnect falhou: ${err?.message ?? err}`);
    }
  }

  /** Há alguém na sala: local primeiro; vazia aqui, a presença das outras réplicas. Nunca lança. */
  private async alguemNaSala(sala: string): Promise<boolean> {
    try {
      if (this.locaisNaSala(sala) > 0) return true;
      if (!this.presenca) return false;
      return await this.presenca.outrasReplicasNaSala(sala);
    } catch {
      return false;
    }
  }

  emitToCondominio(idCondominio: number, event: string, payload: unknown) {
    this.server?.to(`condominio:${idCondominio}`).emit(event, payload);
  }

  /** Evento só para os porteiros conectados no console do condomínio (interfone). */
  emitirPortaria(idCondominio: number, evento: string, dados: unknown) {
    this.server?.to(salaPortaria(idCondominio)).emit(evento, dados);
  }

  /** Há ao menos um porteiro com o console aberto neste condomínio (em qualquer réplica)? Nunca lança. */
  async porteirosOnline(idCondominio: number): Promise<boolean> {
    return this.alguemNaSala(salaPortaria(idCondominio));
  }

  /** Evento só para os operadores da central conectados. */
  emitirCentral(evento: string, dados: unknown): void {
    this.server?.to(SALA_CENTRAL).emit(evento, dados);
  }

  /** Há ao menos um operador da central conectado (em qualquer réplica)? Nunca lança. */
  async centralOnline(): Promise<boolean> {
    return this.alguemNaSala(SALA_CENTRAL);
  }
}
