import { Injectable, inject, signal } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { REALTIME_ORIGIN } from '../shared/api.config';
import { CentralAuthService, tokenCentralValido } from './central-auth.service';

type Ouvinte = (dados: any) => void;

/** Primeira espera para reconectar depois que o servidor derrubou o socket; dobra a cada queda seguida. */
const RECONEXAO_BASE_MS = 5_000;
const RECONEXAO_TETO_MS = 60_000;
/** Conexão que ficou de pé por isto já não conta como "queda seguida": a próxima espera volta à base. */
const CONEXAO_ESTAVEL_MS = 30_000;

/**
 * Tempo real da Central: socket próprio com o `central_token` (o servidor põe o operador na sala `central`).
 * Separado do RealtimeService do porteiro: as duas sessões podem estar abertas no mesmo navegador.
 *
 * Eventos: `interfone:chamada`, `interfone:fim`, `interfone:pedido`, `alerta:novo` (e `connect`, a cada
 * reconexão — o store recarrega a fila). O token é lido a cada (re)conexão; token com `trocar_senha` o servidor
 * recusa, então a troca de senha (tokenRenovado$) reconecta o mesmo socket com o token novo, mantendo os ouvintes.
 *
 * Servidor derrubou o socket (`io server disconnect`: sessão revogada, ou a reconferência não pôde conferir): o
 * socket.io não tenta de novo sozinho nesse caso. Com o token ainda válido, reconecta em 5 s (dobrando até 60 s
 * em quedas seguidas) — se a sessão foi revogada, o servidor recusa de novo; se foi o banco, volta quando ele
 * voltar. Token vencido: relê a sessão e a tela volta ao login.
 */
@Injectable({ providedIn: 'root' })
export class CentralRealtimeService {
  private readonly auth = inject(CentralAuthService);
  private socket: Socket | null = null;
  private readonly ouvintes = new Map<string, Set<Ouvinte>>();

  /** Conectado agora. Gravado pelos eventos do socket (fora de evento do Angular). */
  readonly conectado = signal(false);
  /** O servidor derrubou o socket e há uma nova tentativa agendada (o aviso da tela diz isso). */
  readonly reconectando = signal(false);

  private timerReconexao: ReturnType<typeof setTimeout> | null = null;
  private quedasSeguidas = 0;
  private conectouEm = 0;

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
    this.cancelarReconexao();
    this.quedasSeguidas = 0;
    this.ouvintes.clear();
    this.socket?.disconnect();
    this.socket = null;
    this.conectado.set(false);
  }

  private cancelarReconexao(): void {
    if (this.timerReconexao) clearTimeout(this.timerReconexao);
    this.timerReconexao = null;
    this.reconectando.set(false);
  }

  private aoConectar(): void {
    this.cancelarReconexao();
    this.conectouEm = Date.now();
    this.conectado.set(true);
  }

  private aoCair(socket: Socket, motivo: unknown): void {
    this.conectado.set(false);
    // Só a queda causada pelo servidor fica sem nova tentativa do socket.io; as outras ele refaz sozinho.
    if (motivo !== 'io server disconnect' || this.socket !== socket) return;
    if (!tokenCentralValido(this.auth.token)) {
      this.cancelarReconexao();
      this.auth.recarregar();
      return;
    }
    if (this.conectouEm && Date.now() - this.conectouEm >= CONEXAO_ESTAVEL_MS) this.quedasSeguidas = 0;
    const espera = Math.min(RECONEXAO_BASE_MS * 2 ** this.quedasSeguidas, RECONEXAO_TETO_MS);
    this.quedasSeguidas++;
    if (this.timerReconexao) clearTimeout(this.timerReconexao);
    this.reconectando.set(true);
    this.timerReconexao = setTimeout(() => {
      this.timerReconexao = null;
      if (this.socket !== socket || socket.connected) return;
      if (!tokenCentralValido(this.auth.token)) {
        this.reconectando.set(false);
        this.auth.recarregar();
        return;
      }
      socket.connect();
    }, espera);
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
    socket.on('connect', () => this.aoConectar());
    socket.on('disconnect', (motivo: unknown) => this.aoCair(socket, motivo));
    socket.on('connect_error', () => this.conectado.set(false));
    for (const [evento, lista] of this.ouvintes) for (const cb of lista) socket.on(evento, cb);
    return socket;
  }
}
