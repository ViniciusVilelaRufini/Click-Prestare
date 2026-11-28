import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ehLoginDePortaria, ehPorteiro } from '../auth/papel';
import { RealtimeService } from '../shared/realtime.service';
import { ChamadaHoje, DadosEntrada, EventoChamada, InterfoneApi, TipoChamada } from './interfone.api';
import { CAUSA_MICROFONE, EstadoSessao, FimSessao, SessaoVoz, SipVoz } from './sip-voz';
import { ToqueInterfone } from './toque';

/** Chamada no painel do porteiro. `saindo` = foi a portaria que ligou (para a unidade). */
export interface ChamadaConsole extends EventoChamada {
  saindo?: boolean;
}

const TIPOS: TipoChamada[] = ['facial_unidade', 'portaria_unidade', 'unidade_portaria'];
/** Depois de iniciar, quanto esperar o socket conectar antes de avisar que caiu (evita o aviso piscar ao abrir). */
const CARENCIA_CONEXAO_MS = 5_000;
const AVISO_MS = 6_000;
/** Módulo desligado: confere de novo de tempos em tempos (o síndico pode ligar com a portaria aberta). */
const RECONFERIR_DESLIGADO_MS = 10 * 60_000;
const NOVA_TENTATIVA_MS = 60_000;
/** Teto local de uma chamada tocando sem `interfone:fim` (o toque na portaria vai até 120 s). */
const TETO_TOQUE_MS = 130_000;
/** Chamada que tocou há menos que isto nunca é derrubada pela lista do dia (a lista pode ser mais velha que o evento). */
const PROTECAO_EVENTO_MS = 5_000;

/** Mensagens dos 409 com `motivo` (contrato da API). */
const MOTIVOS: Record<string, string> = {
  em_andamento: 'Já existe uma ligação em andamento.',
  indisponivel: 'Interfone indisponível no momento.',
  sem_app: 'Ninguém dessa unidade recebe chamadas pelo app.',
  portaria_indisponivel: 'Portaria indisponível agora.',
};

/**
 * Estado do interfone no console da portaria. Só existe para login de porteiro com o módulo ligado
 * (`GET /interfone/portaria/hoje` 403/404 = desligado).
 *
 * Zoneless: os callbacks do Socket.IO, do JsSIP e dos timers chegam fora de evento do Angular — tudo que a tela
 * mostra é gravado em signal.
 *
 * Fim da chamada: `interfone:fim` só tira a chamada da lista de toque. A conversa em andamento termina pelo SIP (a
 * central desliga o canal) ou pelo ENCERRAR — a API emite `interfone:fim` aos consoles também quando alguém atende,
 * inclusive quando quem atendeu foi este console.
 */
@Injectable({ providedIn: 'root' })
export class InterfoneStore {
  private readonly api = inject(InterfoneApi);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly sip = inject(SipVoz);
  private readonly toque = inject(ToqueInterfone);

  readonly ativo = signal(false);
  readonly tocando = signal<ChamadaConsole[]>([]);
  readonly emChamada = signal<ChamadaConsole | null>(null);
  readonly estado = signal<EstadoSessao | null>(null);
  readonly hoje = signal<ChamadaHoje[]>([]);
  readonly mudo = signal(false);
  readonly abrindo = signal(false);
  /** id da chamada com o ATENDER em andamento (pedido à API). */
  readonly atendendo = signal<number | null>(null);
  readonly discando = signal(false);
  /** Hora (ms) em que a conversa começou — o contador do painel. */
  readonly inicioConversa = signal<number | null>(null);
  /** Mensagem curta que some sozinha ("Portão aberto.", "Ninguém atendeu."). */
  readonly aviso = signal<string | null>(null);
  readonly erro = signal<string | null>(null);
  readonly microfoneNegado = signal(false);
  private readonly carenciaConexao = signal(true);

  /** O navegador bloqueou o som (autoplay): o painel mostra 'Clique para ativar o som do interfone'. */
  readonly somBloqueado = computed(() => this.toque.bloqueado());

  readonly podeAbrir = computed(() => {
    const c = this.emChamada();
    return !!c && c.tipo === 'facial_unidade' && this.estado() === 'em_chamada' && !this.abrindo();
  });

  /** Por que este console não vai tocar agora (null = tudo certo). */
  readonly semChamadas = computed<string | null>(() => {
    if (!this.ativo()) return null;
    if (this.microfoneNegado()) {
      return 'O navegador bloqueou o microfone. Você não vai receber chamadas do interfone até liberar o microfone para este site.';
    }
    if (!this.realtime.conectado() && !this.carenciaConexao()) {
      return 'Sem conexão com a central. Você não vai receber chamadas do interfone.';
    }
    return null;
  });

  private iniciado = false;
  private cancelamentos: (() => void)[] = [];
  private sessao: SessaoVoz | null = null;
  /** Chamadas que já receberam `interfone:fim` (não voltam a tocar se o atender falhar depois). */
  private readonly encerradas = new Set<number>();
  private video: HTMLVideoElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private timerAviso: ReturnType<typeof setTimeout> | null = null;
  private timerCarencia: ReturnType<typeof setTimeout> | null = null;
  private timerReconferir: ReturnType<typeof setTimeout> | null = null;
  /** Teto local por chamada tocando (id → timer). */
  private readonly tetos = new Map<number, ReturnType<typeof setTimeout>>();
  /** Hora (ms) do último `interfone:chamada` de cada chamada tocando. */
  private readonly ultimoEvento = new Map<number, number>();

  /** É "a portaria" do interfone: login de porteiro (vale o token; o turno é texto livre). */
  private souPortaria(): boolean {
    return ehLoginDePortaria(this.auth.token) || ehPorteiro(this.auth.porteiroInfo());
  }

  iniciar(): void {
    if (this.iniciado || !this.souPortaria()) return;
    this.iniciado = true;
    this.api.hoje().subscribe({
      next: (lista) => {
        if (!this.iniciado) return;
        this.hoje.set(Array.isArray(lista) ? lista : []);
        this.ativar();
      },
      error: (e: HttpErrorResponse) => {
        if (!this.iniciado) return;
        this.ativo.set(false);
        const desligado = e?.status === 403 || e?.status === 404;
        this.agendarReconferir(desligado ? RECONFERIR_DESLIGADO_MS : NOVA_TENTATIVA_MS);
      },
    });
  }

  parar(): void {
    const sessao = this.sessao;
    this.sessao = null;
    sessao?.encerrar();
    this.cancelamentos.forEach((f) => f());
    this.cancelamentos = [];
    for (const t of [this.timerAviso, this.timerCarencia, this.timerReconferir]) if (t) clearTimeout(t);
    this.timerAviso = this.timerCarencia = this.timerReconferir = null;
    const estavaAtivo = this.iniciado;
    this.iniciado = false;
    this.ativo.set(false);
    this.tocando.set([]);
    this.limparChamada();
    this.atendendo.set(null);
    this.discando.set(false);
    this.encerradas.clear();
    for (const t of this.tetos.values()) clearTimeout(t);
    this.tetos.clear();
    this.ultimoEvento.clear();
    this.toque.descartar();
    if (estavaAtivo) this.realtime.disconnect();
  }

  /** O painel entrega os elementos onde o vídeo do facial e o áudio da chamada tocam. */
  registrarMidia(video: HTMLVideoElement | null, audio: HTMLAudioElement | null): void {
    this.video = video;
    this.audio = audio;
  }

  async atender(id: number): Promise<void> {
    if (this.emChamada() || this.atendendo() !== null || this.discando()) return;
    const chamada = this.tocando().find((c) => c.id === id);
    if (!chamada) return;
    this.atendendo.set(id);
    this.erro.set(null);
    this.aviso.set(null);
    this.atualizarToque();

    let dados: DadosEntrada;
    try {
      dados = await firstValueFrom(this.api.atender(id));
    } catch (e) {
      this.atendendo.set(null);
      const err = e as HttpErrorResponse;
      if (err?.status === 409 || err?.status === 404) {
        this.tirarDoToque(id);
        const motivo = err?.error?.motivo;
        this.mostrarAviso(
          (typeof motivo === 'string' && Object.hasOwn(MOTIVOS, motivo) ? MOTIVOS[motivo] : undefined) ??
            (motivo === 'encerrada' || err?.status === 404 ? 'Chamada encerrada.' : 'Chamada já atendida.'),
        );
      } else {
        this.erro.set(mensagemDaApi(err) ?? 'Não foi possível atender. Tente de novo.');
      }
      this.atualizarToque();
      return;
    }

    this.atendendo.set(null);
    if (!this.iniciado) return;
    this.tirarDoToque(id);
    this.emChamada.set(chamada);
    this.estado.set('conectando');
    this.atualizarToque();
    await this.conectar(dados, chamada, () => {
      // Não conectou: se a chamada ainda toca, volta para a lista (outro porteiro, ou este de novo).
      if (!this.encerradas.has(id)) this.colocarNoToque(chamada);
    });
  }

  async ligar(idApartamento: number, unidade: string): Promise<void> {
    if (!this.ativo() || this.emChamada() || this.atendendo() !== null || this.discando()) return;
    this.erro.set(null);
    this.aviso.set(null);
    this.discando.set(true);
    let dados: DadosEntrada;
    try {
      dados = await firstValueFrom(this.api.ligar(idApartamento));
    } catch (e) {
      this.discando.set(false);
      this.erro.set(mensagemDaApi(e as HttpErrorResponse) ?? 'Não foi possível ligar para a unidade.');
      return;
    }
    this.discando.set(false);
    if (!this.iniciado) return;
    const chamada: ChamadaConsole = {
      id: dados.id,
      tipo: 'portaria_unidade',
      unidade,
      motivo: null,
      morador_nome: null,
      foto_url: null,
      saindo: true,
    };
    this.emChamada.set(chamada);
    this.estado.set('conectando');
    this.atualizarToque();
    await this.conectar(dados, chamada, () => undefined);
  }

  encerrar(): void {
    const c = this.emChamada();
    if (!c) return;
    const sessao = this.sessao;
    this.sessao = null;
    this.limparChamada();
    sessao?.encerrar();
    this.api.encerrar(c.id).subscribe({
      next: () => this.recarregarHoje(),
      error: () => this.recarregarHoje(),
    });
    this.atualizarToque();
  }

  abrir(): void {
    const c = this.emChamada();
    if (!c || !this.podeAbrir()) return;
    this.abrindo.set(true);
    this.api.abrir(c.id).subscribe({
      next: (r) => {
        this.abrindo.set(false);
        this.mostrarAviso(r?.ok ? 'Portão aberto.' : `Não foi possível abrir${r?.motivo ? ': ' + r.motivo : '.'}`);
      },
      error: (e: HttpErrorResponse) => {
        this.abrindo.set(false);
        const motivo = e?.error?.motivo ?? mensagemDaApi(e);
        this.mostrarAviso(`Não foi possível abrir${motivo ? ': ' + motivo : '.'}`);
      },
    });
  }

  alternarMudo(): void {
    if (!this.sessao) return;
    const novo = !this.mudo();
    this.sessao.mudo(novo);
    this.mudo.set(novo);
  }

  recarregarHoje(): void {
    if (!this.ativo()) return;
    // Foto do momento do disparo: só essas chamadas podem ser reconciliadas com a resposta.
    const disparo = Date.now();
    const tocavam = new Set(this.tocando().map((c) => c.id));
    this.api.hoje().subscribe({
      next: (lista) => {
        this.hoje.set(Array.isArray(lista) ? lista : []);
        this.reconciliarToque(tocavam, disparo);
      },
      error: () => undefined,
    });
  }

  // ===================== internos =====================

  private ativar(): void {
    this.ativo.set(true);
    this.cancelamentos.push(
      this.realtime.on('interfone:chamada', (d) => this.aoChamar(d)),
      this.realtime.on('interfone:fim', (d) => this.aoFim(d)),
      // Reconectou (o socket.io emite 'connect' a cada reconexão): um 'interfone:fim' pode ter se perdido.
      this.realtime.on('connect', () => this.recarregarHoje()),
    );
    this.carenciaConexao.set(true);
    this.timerCarencia = setTimeout(() => this.carenciaConexao.set(false), CARENCIA_CONEXAO_MS);
    this.verificarMicrofone();
    this.toque.preparar();
  }

  private agendarReconferir(ms: number): void {
    if (this.timerReconferir) clearTimeout(this.timerReconferir);
    this.timerReconferir = setTimeout(() => {
      this.timerReconferir = null;
      if (this.ativo()) return;
      this.iniciado = false;
      this.iniciar();
    }, ms);
  }

  private aoChamar(d: unknown): void {
    const ev = d as Partial<EventoChamada> | null;
    const id = Number(ev?.id);
    if (!ev || !Number.isFinite(id) || id <= 0) return;
    // Tipo desconhecido é ignorado: virar 'facial_unidade' mostraria ABRIR PORTÃO.
    if (!TIPOS.includes(ev.tipo as TipoChamada)) return;
    const tipo = ev.tipo as TipoChamada;
    // A ligação que a própria portaria fez não toca nos consoles.
    if (tipo === 'portaria_unidade') return;
    if (this.emChamada()?.id === id) return;
    this.encerradas.delete(id);
    this.ultimoEvento.set(id, Date.now());
    this.colocarNoToque({
      id,
      tipo,
      unidade: typeof ev.unidade === 'string' ? ev.unidade : '',
      motivo: ev.motivo ?? null,
      morador_nome: ev.morador_nome ?? null,
      foto_url: ev.foto_url ?? null,
    });
  }

  private aoFim(d: unknown): void {
    const id = Number((d as { id?: unknown } | null)?.id);
    if (!Number.isFinite(id)) return;
    this.encerradas.add(id);
    this.tirarDoToque(id);
    this.atualizarToque();
    if (this.emChamada()?.id !== id) this.recarregarHoje();
  }

  private async conectar(d: DadosEntrada, chamada: ChamadaConsole, aoFalhar: () => void): Promise<void> {
    let sessao: SessaoVoz;
    try {
      sessao = await this.sip.entrar(d, this.video, this.audio);
    } catch (e) {
      if (this.emChamada()?.id === chamada.id) this.limparChamada();
      if ((e as { name?: string })?.name === 'NotAllowedError') this.marcarMicrofoneNegado();
      else this.erro.set('Não foi possível conectar à central de voz.');
      aoFalhar();
      this.atualizarToque();
      return;
    }
    // Encerrou (ou saiu do console) enquanto conectava.
    if (this.emChamada()?.id !== chamada.id) {
      sessao.encerrar();
      return;
    }
    this.sessao = sessao;
    this.estado.set(sessao.estado === 'encerrada' ? 'conectando' : sessao.estado);
    if (sessao.estado === 'em_chamada') this.inicioConversa.set(Date.now());
    sessao.aoEstado((e) => {
      if (this.sessao !== sessao || e === 'encerrada') return;
      this.estado.set(e);
      if (e === 'em_chamada' && this.inicioConversa() === null) this.inicioConversa.set(Date.now());
    });
    sessao.aoEncerrar((fim) => this.aoSessaoEncerrar(sessao, chamada, fim));
  }

  private aoSessaoEncerrar(sessao: SessaoVoz, chamada: ChamadaConsole, fim: FimSessao): void {
    if (this.sessao !== sessao) return;
    this.sessao = null;
    this.limparChamada();
    if (fim.causa === CAUSA_MICROFONE) {
      this.marcarMicrofoneNegado();
    } else if (!fim.atendida) {
      this.mostrarAviso(chamada.saindo ? 'Ninguém atendeu.' : 'A chamada terminou antes de conectar.');
    }
    this.atualizarToque();
    this.recarregarHoje();
  }

  private marcarMicrofoneNegado(): void {
    this.microfoneNegado.set(true);
    this.erro.set('O navegador bloqueou o microfone. Libere o microfone para este site e tente de novo.');
  }

  private verificarMicrofone(): void {
    try {
      const perms = (globalThis.navigator as Navigator | undefined)?.permissions;
      if (!perms?.query) return;
      perms
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          this.microfoneNegado.set(status.state === 'denied');
          status.onchange = () => this.microfoneNegado.set(status.state === 'denied');
        })
        .catch(() => undefined); // navegador sem a consulta de microfone (Firefox): só descobre ao atender
    } catch {
      /* sem API de permissões */
    }
  }

  private limparChamada(): void {
    this.emChamada.set(null);
    this.estado.set(null);
    this.mudo.set(false);
    this.abrindo.set(false);
    this.inicioConversa.set(null);
  }

  /**
   * Tira do toque o que a lista do dia já mostra fora da portaria: chamada de facial que não está mais em
   * `portaria`, chamada do morador que não está em `portaria`/`chamando`. Sem item ou sem `estado`, fica (o teto
   * local de 130 s cuida).
   */
  private reconciliarToque(tocavam: Set<number>, disparo: number): void {
    const estados = new Map(this.hoje().map((h) => [h.id, h.estado] as const));
    const agora = Date.now();
    const fora = this.tocando().filter((c) => {
      // A resposta pode ser mais velha que o evento: só mexe no que já tocava quando o GET saiu, cujo último
      // evento é anterior ao disparo e tem pelo menos 5 s.
      if (!tocavam.has(c.id)) return false;
      const ev = this.ultimoEvento.get(c.id) ?? 0;
      if (ev >= disparo || agora - ev < PROTECAO_EVENTO_MS) return false; // mesmo ms do disparo conta como mais novo
      const e = estados.get(c.id);
      if (!e) return false;
      return c.tipo === 'unidade_portaria' ? e !== 'portaria' && e !== 'chamando' : e !== 'portaria';
    });
    if (!fora.length) return;
    for (const c of fora) this.tirarDoToque(c.id);
    this.atualizarToque();
  }

  /** Clique no aviso de som bloqueado (é um gesto do usuário: o navegador deixa tocar). */
  ativarSom(): void {
    this.toque.desbloquear();
  }

  private colocarNoToque(c: ChamadaConsole): void {
    this.tocando.update((lista) => {
      const i = lista.findIndex((x) => x.id === c.id);
      if (i < 0) return [...lista, c];
      const nova = [...lista];
      nova[i] = c;
      return nova;
    });
    // Teto local: conta da primeira vez que tocou (evento repetido não estende).
    if (!this.tetos.has(c.id)) {
      this.tetos.set(
        c.id,
        setTimeout(() => {
          this.tetos.delete(c.id);
          this.tirarDoToque(c.id);
          this.atualizarToque();
        }, TETO_TOQUE_MS),
      );
    }
    this.atualizarToque();
  }

  private tirarDoToque(id: number): void {
    const teto = this.tetos.get(id);
    if (teto) clearTimeout(teto);
    this.tetos.delete(id);
    this.ultimoEvento.delete(id);
    this.tocando.update((lista) => lista.filter((c) => c.id !== id));
  }

  /** Toca enquanto houver chamada esperando e o porteiro não estiver em conversa. */
  private atualizarToque(): void {
    const tocar = this.tocando().length > 0 && !this.emChamada() && this.atendendo() === null;
    if (tocar) this.toque.tocar();
    else this.toque.parar();
  }

  private mostrarAviso(texto: string): void {
    this.aviso.set(texto);
    if (this.timerAviso) clearTimeout(this.timerAviso);
    this.timerAviso = setTimeout(() => {
      this.timerAviso = null;
      this.aviso.set(null);
    }, AVISO_MS);
  }
}

function mensagemDaApi(e: HttpErrorResponse | null | undefined): string | null {
  const motivo = e?.error?.motivo;
  if (typeof motivo === 'string' && Object.hasOwn(MOTIVOS, motivo)) return MOTIVOS[motivo];
  const m = e?.error?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}
