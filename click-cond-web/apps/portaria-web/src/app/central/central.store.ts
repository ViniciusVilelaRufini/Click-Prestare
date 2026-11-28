import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CAUSA_MICROFONE, EstadoSessao, FimSessao, SessaoVoz, SipVoz } from '../interfone/sip-voz';
import { ToqueInterfone } from '../interfone/toque';
import { mensagemDoAbrir } from '../interfone/interfone.store';
import { AlarmeCentral } from './central-alarme';
import {
  AlertaCentral,
  CentralApi,
  ChamadaCentral,
  CondominioCentral,
  ContextoChamada,
  DadosEntrada,
  EventoPedido,
  MOTIVOS_ABERTURA,
  MotivoAbertura,
  NovoPedido,
  PedidoResumo,
  TipoPedido,
} from './central-api';
import { CentralRealtimeService } from './central-realtime.service';

/** Chamada com o operador. `saindo` = foi o operador que ligou para a unidade. */
export interface ChamadaEmCurso extends ChamadaCentral {
  saindo?: boolean;
}

/** Tipos que esperam alguém na portaria (o que entra na fila). */
const TIPOS_FILA = ['facial_unidade', 'facial_portaria', 'unidade_portaria'];
/** Tipos com portão para abrir. */
const TIPOS_COM_PORTAO = ['facial_unidade', 'facial_portaria'];
const AVISO_MS = 6_000;
/** Rede de segurança do socket: a fila e os alertas também são relidos de tempos em tempos. */
const RECARREGAR_FILA_MS = 15_000;
const RECARREGAR_ALERTAS_MS = 30_000;
const DETALHE_MAX = 255;
const PEDIDO_NOME_MAX = 120;

/** Mensagens dos 409 (e 404) com `motivo` (contrato da API). */
const MOTIVOS: Record<string, string> = {
  atendida_por_outro: 'Outra pessoa já atendeu esta chamada.',
  ja_atendida: 'Outra pessoa já atendeu esta chamada.',
  encerrada: 'A chamada já terminou.',
  em_andamento: 'Você já tem uma ligação em andamento.',
  indisponivel: 'Interfone indisponível no momento.',
  sem_app: 'Ninguém dessa unidade recebe chamadas pelo app.',
  modulo_desligado: 'O interfone não está ligado neste condomínio.',
  pedido_respondido: 'O morador já respondeu este pedido.',
  pedido_expirado: 'O pedido expirou.',
  limite_pedidos: 'Limite de 3 pedidos nesta chamada.',
  pedido_pendente: 'Já há um pedido esperando a resposta do morador.',
};

function mensagemDaApi(e: HttpErrorResponse | null | undefined): string | null {
  const motivo = e?.error?.motivo;
  if (typeof motivo === 'string' && Object.hasOwn(MOTIVOS, motivo)) return MOTIVOS[motivo];
  const m = e?.error?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}

function ordenarFila(lista: ChamadaCentral[]): ChamadaCentral[] {
  return [...lista].sort((a, b) => {
    const ta = Date.parse(a.criada_em) || 0;
    const tb = Date.parse(b.criada_em) || 0;
    return ta - tb || a.id - b.id;
  });
}

function paraChamada(d: unknown): ChamadaCentral | null {
  const ev = d as Partial<ChamadaCentral> | null;
  const id = Number(ev?.id);
  if (!ev || !Number.isInteger(id) || id <= 0) return null;
  if (!TIPOS_FILA.includes(String(ev.tipo))) return null;
  return {
    id,
    tipo: String(ev.tipo),
    unidade: typeof ev.unidade === 'string' ? ev.unidade : '',
    motivo: ev.motivo ?? null,
    morador_nome: ev.morador_nome ?? null,
    foto_url: ev.foto_url ?? null,
    id_condominio: Number(ev.id_condominio) || 0,
    condominio: typeof ev.condominio === 'string' ? ev.condominio : '',
    portao: ev.portao ?? null,
    criada_em: typeof ev.criada_em === 'string' ? ev.criada_em : new Date().toISOString(),
  };
}

function paraAlerta(d: unknown): AlertaCentral | null {
  const a = d as Partial<AlertaCentral> | null;
  const id = Number(a?.id);
  if (!a || !Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    id_condominio: Number(a.id_condominio) || 0,
    condominio: typeof a.condominio === 'string' ? a.condominio : '',
    tipo: String(a.tipo ?? ''),
    descricao: String(a.descricao ?? ''),
    created_at: typeof a.created_at === 'string' ? a.created_at : new Date().toISOString(),
    visto_em: a.visto_em ?? null,
    visto_por: a.visto_por ?? null,
  };
}

function semExtras(p: EventoPedido | PedidoResumo): PedidoResumo {
  return {
    id: p.id,
    estado: p.estado,
    nome_falado: p.nome_falado,
    motivo: p.motivo ?? null,
    tipo: p.tipo,
    mensagem: p.mensagem ?? null,
    respondido_por_nome: p.respondido_por_nome ?? null,
    respondido_em: p.respondido_em ?? null,
    portao_aberto: !!p.portao_aberto,
    alcance: p.alcance ? { apps: Number(p.alcance.apps) || 0, antigos: Number(p.alcance.antigos) || 0 } : null,
  };
}

/**
 * Estado da área Central (operadores da Prestare). Zoneless: callbacks do socket, do JsSIP e dos timers chegam
 * fora de evento do Angular — tudo que a tela mostra fica em signal.
 *
 * Fila: chamadas encaminhadas para a central de todos os condomínios, mais antiga primeiro; sai em
 * `interfone:fim` (atendida por alguém, desligada ou esgotada). Toca enquanto houver fila e o operador não
 * estiver em conversa. Alertas: pânico toca a sirene até alguém marcar "visto".
 */
@Injectable({ providedIn: 'root' })
export class CentralStore {
  private readonly api = inject(CentralApi);
  private readonly realtime = inject(CentralRealtimeService);
  private readonly sip = inject(SipVoz);
  private readonly toque = inject(ToqueInterfone);
  private readonly alarme = inject(AlarmeCentral);

  readonly fila = signal<ChamadaCentral[]>([]);
  readonly emChamada = signal<ChamadaEmCurso | null>(null);
  readonly estado = signal<EstadoSessao | null>(null);
  readonly contexto = signal<ContextoChamada | null>(null);
  /**
   * Chamada cujo contexto está na direita: a em curso ou a que acabou. A que acabou fica até o operador fechar ou
   * atender outra — o morador pode responder o pedido até 5 min depois, e o resultado chega ao vivo.
   */
  readonly chamadaDoContexto = signal<ChamadaEmCurso | null>(null);
  readonly contextoEncerrado = computed(() => {
    const c = this.chamadaDoContexto();
    return !!c && this.emChamada()?.id !== c.id;
  });
  readonly carregandoContexto = signal(false);
  readonly alertasAbertos = signal<AlertaCentral[]>([]);
  readonly condominios = signal<CondominioCentral[]>([]);
  readonly mudo = signal(false);
  readonly abrindo = signal(false);
  readonly pedindo = signal(false);
  /** id da chamada com o ATENDER em andamento. */
  readonly atendendo = signal<number | null>(null);
  readonly discando = signal(false);
  readonly inicioConversa = signal<number | null>(null);
  readonly aviso = signal<string | null>(null);
  readonly erro = signal<string | null>(null);
  readonly microfoneNegado = signal(false);
  /** ids dos alertas com o "visto" em andamento. */
  readonly marcando = signal<ReadonlySet<number>>(new Set());

  /** Há pânico sem "visto": a sirene toca. */
  readonly somAlerta = computed(() => this.alertasAbertos().some((a) => a.tipo === 'panico'));
  readonly conectado = computed(() => this.realtime.conectado());
  /** A Central derrubou o socket e uma nova tentativa já está agendada. */
  readonly reconectando = computed(() => !this.realtime.conectado() && this.realtime.reconectando());
  /** O navegador bloqueou o som (autoplay): a tela mostra "Clique para ativar o som". */
  readonly somBloqueado = computed(() => this.toque.bloqueado() || this.alarme.bloqueado());
  readonly ocupado = computed(() => !!this.emChamada() || this.atendendo() !== null || this.discando());
  readonly podeAbrir = computed(() => {
    const c = this.emChamada();
    return !!c && TIPOS_COM_PORTAO.includes(String(c.tipo)) && this.estado() === 'em_chamada' && !this.abrindo();
  });

  private iniciado = false;
  private cancelamentos: (() => void)[] = [];
  private sessao: SessaoVoz | null = null;
  private video: HTMLVideoElement | null = null;
  private audio: HTMLAudioElement | null = null;
  private timerAviso: ReturnType<typeof setTimeout> | null = null;
  private timerFila: ReturnType<typeof setInterval> | null = null;
  private timerAlertas: ReturnType<typeof setInterval> | null = null;
  /** Hora (ms) do último `interfone:chamada` de cada chamada (a resposta do GET pode ser mais velha). */
  private readonly ultimoEvento = new Map<number, number>();
  /** Hora (ms) do `interfone:fim` de cada chamada. */
  private readonly fins = new Map<number, number>();

  iniciar(): void {
    if (this.iniciado) return;
    this.iniciado = true;
    this.cancelamentos.push(
      this.realtime.on('interfone:chamada', (d) => this.aoChamar(d)),
      this.realtime.on('interfone:fim', (d) => this.aoFim(d)),
      this.realtime.on('interfone:pedido', (d) => this.aoPedido(d)),
      this.realtime.on('alerta:novo', (d) => this.aoAlerta(d)),
      // Outro operador marcou "visto": sai da tela e a sirene para para todos.
      this.realtime.on('alerta:visto', (d) => this.aoVisto(d)),
      // Reconectou: algum evento pode ter se perdido.
      this.realtime.on('connect', () => {
        this.recarregarFila();
        this.recarregarAlertas();
      }),
    );
    this.recarregarFila();
    this.recarregarAlertas();
    this.recarregarCondominios();
    this.timerFila = setInterval(() => this.recarregarFila(), RECARREGAR_FILA_MS);
    this.timerAlertas = setInterval(() => this.recarregarAlertas(), RECARREGAR_ALERTAS_MS);
    this.verificarMicrofone();
    this.toque.preparar();
    this.alarme.preparar();
  }

  parar(): void {
    const sessao = this.sessao;
    this.sessao = null;
    sessao?.encerrar();
    this.cancelamentos.forEach((f) => f());
    this.cancelamentos = [];
    for (const t of [this.timerFila, this.timerAlertas]) if (t) clearInterval(t);
    if (this.timerAviso) clearTimeout(this.timerAviso);
    this.timerFila = this.timerAlertas = this.timerAviso = null;
    const estava = this.iniciado;
    this.iniciado = false;
    this.fila.set([]);
    this.alertasAbertos.set([]);
    this.limparChamada();
    this.fecharContexto();
    this.atendendo.set(null);
    this.discando.set(false);
    this.ultimoEvento.clear();
    this.fins.clear();
    this.toque.descartar();
    this.alarme.descartar();
    if (estava) this.realtime.desconectar();
  }

  /** A tela entrega os elementos onde o vídeo do facial e o áudio da chamada tocam. */
  registrarMidia(video: HTMLVideoElement | null, audio: HTMLAudioElement | null): void {
    this.video = video;
    this.audio = audio;
  }

  // ===================== fila e atendimento =====================

  async atender(id: number): Promise<void> {
    if (this.ocupado()) return;
    const chamada = this.fila().find((c) => c.id === id);
    if (!chamada) return;
    this.atendendo.set(id);
    this.erro.set(null);
    this.aviso.set(null);
    this.atualizarSom();

    let dados: DadosEntrada;
    try {
      dados = await firstValueFrom(this.api.atender(id));
    } catch (e) {
      this.atendendo.set(null);
      const err = e as HttpErrorResponse;
      if (err?.status === 409 || err?.status === 404) {
        this.tirarDaFila(id);
        this.mostrarAviso(mensagemDaApi(err) ?? (err?.status === 404 ? 'A chamada já terminou.' : MOTIVOS['atendida_por_outro']));
      } else {
        this.erro.set(mensagemDaApi(err) ?? 'Não foi possível atender. Tente de novo.');
      }
      this.atualizarSom();
      return;
    }

    this.atendendo.set(null);
    if (!this.iniciado) return;
    this.tirarDaFila(id);
    this.emChamada.set(chamada);
    this.estado.set('conectando');
    this.carregarContexto(chamada);
    this.atualizarSom();
    await this.conectar(dados, chamada, () => {
      // Não conectou: se a chamada ainda espera, volta para a fila (outro operador, ou este de novo).
      if (!this.fins.has(id)) this.colocarNaFila(chamada);
    });
  }

  /** Abre o portão da chamada com o motivo (obrigatório; `outro` exige o detalhe). */
  async abrir(codigo: MotivoAbertura, detalhe?: string): Promise<boolean> {
    const c = this.emChamada();
    if (!c || !this.podeAbrir()) return false;
    if (!MOTIVOS_ABERTURA.some((m) => m.codigo === codigo)) {
      this.erro.set('Escolha o motivo da abertura do portão.');
      return false;
    }
    const texto = String(detalhe ?? '').trim().slice(0, DETALHE_MAX);
    if (codigo === 'outro' && !texto) {
      this.erro.set('Descreva o motivo da abertura do portão.');
      return false;
    }
    this.erro.set(null);
    this.abrindo.set(true);
    try {
      const r = await firstValueFrom(this.api.abrir(c.id, codigo, texto || undefined));
      this.mostrarAviso(r?.ok ? 'Portão aberto.' : mensagemDoAbrir(r?.motivo));
      return !!r?.ok;
    } catch (e) {
      const err = e as HttpErrorResponse;
      const motivo = err?.error?.motivo;
      this.mostrarAviso(
        typeof motivo === 'string' && motivo.startsWith('motivo_')
          ? (mensagemDaApi(err) ?? 'Informe o motivo da abertura do portão.')
          : mensagemDoAbrir(motivo),
      );
      return false;
    } finally {
      this.abrindo.set(false);
    }
  }

  encerrar(): void {
    const c = this.emChamada();
    if (!c) return;
    const sessao = this.sessao;
    this.sessao = null;
    this.limparChamada();
    sessao?.encerrar();
    this.api.encerrar(c.id).subscribe({ error: () => undefined });
    this.atualizarSom();
  }

  alternarMudo(): void {
    if (!this.sessao) return;
    const novo = !this.mudo();
    this.sessao.mudo(novo);
    this.mudo.set(novo);
  }

  /** Pede ao morador para autorizar a entrada (push no app). Em `facial_portaria` o operador escolhe a unidade. */
  async pedirAutorizacao(nome: string, motivo: string | null | undefined, tipo: TipoPedido, idApartamento?: number): Promise<boolean> {
    const c = this.emChamada();
    if (!c || this.pedindo()) return false;
    const n = String(nome ?? '').trim().slice(0, PEDIDO_NOME_MAX);
    if (!n) {
      this.erro.set('Informe o nome de quem está no portão.');
      return false;
    }
    const dto: NovoPedido = { nome: n, tipo };
    const m = String(motivo ?? '').trim();
    if (m) dto.motivo = m.slice(0, DETALHE_MAX);
    if (idApartamento) dto.id_apartamento = idApartamento;
    this.erro.set(null);
    this.pedindo.set(true);
    try {
      const p = await firstValueFrom(this.api.pedido(c.id, dto));
      if (this.chamadaDoContexto()?.id === c.id) this.contexto.update((ctx) => (ctx ? { ...ctx, pedido: semExtras(p) } : ctx));
      return true;
    } catch (e) {
      this.erro.set(mensagemDaApi(e as HttpErrorResponse) ?? 'Não foi possível enviar o pedido ao morador.');
      return false;
    } finally {
      this.pedindo.set(false);
    }
  }

  /** Liga para uma unidade de um condomínio da central (toca no app dos moradores e nos monitores). */
  async ligar(idCondominio: number, idApartamento: number, rotulo = ''): Promise<void> {
    if (!this.iniciado || this.ocupado()) return;
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
    const cond = this.condominios().find((x) => x.id === idCondominio);
    const chamada: ChamadaEmCurso = {
      id: dados.id,
      tipo: 'portaria_unidade',
      unidade: rotulo,
      motivo: null,
      morador_nome: null,
      foto_url: null,
      id_condominio: idCondominio,
      condominio: cond?.nome ?? '',
      portao: null,
      criada_em: new Date().toISOString(),
      saindo: true,
    };
    this.emChamada.set(chamada);
    this.estado.set('conectando');
    this.carregarContexto(chamada);
    this.atualizarSom();
    await this.conectar(dados, chamada, () => undefined);
  }

  // ===================== alertas =====================

  async marcarVisto(id: number): Promise<void> {
    if (this.marcando().has(id)) return;
    this.marcando.update((s) => new Set([...s, id]));
    try {
      await firstValueFrom(this.api.alertaVisto(id));
      this.alertasAbertos.update((l) => l.filter((a) => a.id !== id));
    } catch (e) {
      const err = e as HttpErrorResponse;
      if (err?.status === 404) this.alertasAbertos.update((l) => l.filter((a) => a.id !== id));
      else this.erro.set('Não foi possível marcar o alerta como visto. Tente de novo.');
    } finally {
      this.marcando.update((s) => new Set([...s].filter((x) => x !== id)));
      this.atualizarSom();
    }
  }

  /** Clique no aviso de som bloqueado (gesto do usuário: o navegador deixa tocar). */
  ativarSom(): void {
    this.toque.desbloquear();
    this.alarme.desbloquear();
  }

  /** "Fechar" no contexto de uma chamada que já terminou. */
  fecharContexto(): void {
    this.chamadaDoContexto.set(null);
    this.contexto.set(null);
    this.carregandoContexto.set(false);
  }

  fecharAviso(): void {
    this.aviso.set(null);
    this.erro.set(null);
  }

  // ===================== recargas =====================

  recarregarFila(): void {
    if (!this.iniciado) return;
    const disparo = Date.now();
    this.api.fila().subscribe({
      next: (lista) => {
        if (!this.iniciado) return;
        const emCurso = this.emChamada()?.id;
        const doServidor = (Array.isArray(lista) ? lista : [])
          .map((c) => paraChamada(c))
          .filter((c): c is ChamadaCentral => !!c && c.id !== emCurso && !((this.fins.get(c.id) ?? -1) >= disparo));
        const ids = new Set(doServidor.map((c) => c.id));
        // O que chegou por evento depois do GET sair fica (a resposta pode ser mais velha que o evento).
        const recentes = this.fila().filter((c) => !ids.has(c.id) && (this.ultimoEvento.get(c.id) ?? -1) >= disparo);
        this.fila.set(ordenarFila([...doServidor, ...recentes]));
        this.atualizarSom();
      },
      error: () => undefined,
    });
  }

  recarregarAlertas(): void {
    if (!this.iniciado) return;
    this.api.alertas(true).subscribe({
      next: (lista) => {
        if (!this.iniciado) return;
        const l = (Array.isArray(lista) ? lista : []).map(paraAlerta).filter((a): a is AlertaCentral => !!a && !a.visto_em);
        this.alertasAbertos.set(l.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id));
        this.atualizarSom();
      },
      error: () => undefined,
    });
  }

  recarregarCondominios(): void {
    this.api.condominios().subscribe({
      next: (l) => this.condominios.set(Array.isArray(l) ? l : []),
      error: () => undefined,
    });
  }

  // ===================== internos =====================

  private aoChamar(d: unknown): void {
    const c = paraChamada(d);
    if (!c || this.emChamada()?.id === c.id) return;
    this.fins.delete(c.id);
    this.ultimoEvento.set(c.id, Date.now());
    this.colocarNaFila(c);
  }

  private aoFim(d: unknown): void {
    const id = Number((d as { id?: unknown } | null)?.id);
    if (!Number.isFinite(id)) return;
    this.fins.set(id, Date.now());
    if (this.fins.size > 500) this.fins.delete(this.fins.keys().next().value as number);
    this.tirarDaFila(id);
    this.atualizarSom();
  }

  private aoPedido(d: unknown): void {
    const ev = d as Partial<EventoPedido> | null;
    if (!ev || !Number.isInteger(Number(ev.id))) return;
    // Vale também para a chamada que acabou e ainda está no painel (resposta tardia do morador).
    const c = this.chamadaDoContexto();
    if (!c || Number(ev.id_chamada) !== c.id) return;
    this.contexto.update((ctx) => (ctx ? { ...ctx, pedido: semExtras(ev as EventoPedido) } : ctx));
  }

  private aoVisto(d: unknown): void {
    const id = Number((d as { id?: unknown } | null)?.id);
    if (!Number.isInteger(id) || id <= 0) return;
    if (!this.alertasAbertos().some((a) => a.id === id)) return;
    this.alertasAbertos.update((l) => l.filter((a) => a.id !== id));
    this.atualizarSom();
  }

  private aoAlerta(d: unknown): void {
    const a = paraAlerta(d);
    if (!a) return;
    this.alertasAbertos.update((l) => [a, ...l.filter((x) => x.id !== a.id)]);
    this.atualizarSom();
  }

  private carregarContexto(chamada: ChamadaEmCurso): void {
    const id = chamada.id;
    this.chamadaDoContexto.set(chamada);
    this.contexto.set(null);
    this.carregandoContexto.set(true);
    this.api.contexto(id).subscribe({
      next: (ctx) => {
        if (this.chamadaDoContexto()?.id !== id) return;
        this.carregandoContexto.set(false);
        this.contexto.set(ctx ? { ...ctx, pedido: ctx.pedido ? semExtras(ctx.pedido) : null } : null);
      },
      error: () => {
        if (this.chamadaDoContexto()?.id === id) this.carregandoContexto.set(false);
      },
    });
  }

  private async conectar(d: DadosEntrada, chamada: ChamadaEmCurso, aoFalhar: () => void): Promise<void> {
    let sessao: SessaoVoz;
    try {
      sessao = await this.sip.entrar(d, this.video, this.audio);
    } catch (e) {
      if (this.emChamada()?.id === chamada.id) this.limparChamada();
      if (this.chamadaDoContexto()?.id === chamada.id) this.fecharContexto();
      if ((e as { name?: string })?.name === 'NotAllowedError') this.marcarMicrofoneNegado();
      else this.erro.set('Não foi possível conectar à central de voz.');
      aoFalhar();
      this.atualizarSom();
      return;
    }
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

  private aoSessaoEncerrar(sessao: SessaoVoz, chamada: ChamadaEmCurso, fim: FimSessao): void {
    if (this.sessao !== sessao) return;
    this.sessao = null;
    this.limparChamada();
    if (fim.causa === CAUSA_MICROFONE) this.marcarMicrofoneNegado();
    else if (!fim.atendida) this.mostrarAviso(chamada.saindo ? 'Ninguém atendeu.' : 'A chamada terminou antes de conectar.');
    this.atualizarSom();
    this.recarregarFila();
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
        .catch(() => undefined);
    } catch {
      /* sem API de permissões */
    }
  }

  private limparChamada(): void {
    this.emChamada.set(null);
    this.estado.set(null);
    this.mudo.set(false);
    this.abrindo.set(false);
    this.pedindo.set(false);
    this.inicioConversa.set(null);
  }

  private colocarNaFila(c: ChamadaCentral): void {
    this.fila.update((l) => ordenarFila([...l.filter((x) => x.id !== c.id), c]));
    this.atualizarSom();
  }

  private tirarDaFila(id: number): void {
    this.ultimoEvento.delete(id);
    this.fila.update((l) => l.filter((c) => c.id !== id));
  }

  /** Toque: fila esperando e operador livre. Sirene: pânico sem "visto" (toca mesmo em conversa). */
  private atualizarSom(): void {
    if (this.fila().length > 0 && !this.emChamada() && this.atendendo() === null) this.toque.tocar();
    else this.toque.parar();
    if (this.somAlerta()) this.alarme.tocar();
    else this.alarme.parar();
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
