import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MOTIVOS_ABERTURA, MotivoAbertura, PedidoResumo, TIPOS_PEDIDO, TipoPedido, UnidadeCentral } from './central-api';
import { CentralBuscaUnidadeComponent } from './central-busca-unidade.component';
import { motivoCentral } from './central-fila.component';
import { ChamadaEmCurso, CentralStore } from './central.store';

const AVISO_FIM_S = 150;
const MAX_CONVERSA_S = 180;

/** Texto do estado do pedido ao morador. */
export function textoDoPedido(p: PedidoResumo): string {
  const quem = p.respondido_por_nome ? ` por ${p.respondido_por_nome}` : '';
  switch (p.estado) {
    case 'pendente':
      return 'Aguardando o morador responder no app…';
    case 'autorizado':
      return `Autorizado${quem}${p.portao_aberto ? ' · portão aberto' : ''}`;
    case 'negado':
      return `Negado${quem}`;
    case 'expirado':
      return 'O pedido expirou sem resposta.';
    default:
      return String(p.estado);
  }
}

/**
 * Quantos celulares o push do pedido alcançou (null enquanto o push não saiu). Sem app que responda, o operador
 * precisa saber logo para resolver de outro jeito (ligar, decidir pelo motivo).
 */
export function textoDoAlcance(p: PedidoResumo): string | null {
  const a = p.alcance;
  if (!a) return null;
  if (a.apps === 0) {
    return 'Nenhum morador pode responder pelo app' + (a.antigos > 0 ? ' — morador com app desatualizado' : '');
  }
  return `Enviado para ${a.apps} ${a.apps === 1 ? 'celular' : 'celulares'}`;
}

/**
 * Centro e direita da Central: a chamada em atendimento (vídeo do facial, áudio, mudo, Abrir portão com motivo,
 * Encerrar) e o contexto para decidir (moradores, esperados hoje, instruções, pedido ao morador ao vivo).
 * Os elementos de vídeo e áudio ficam sempre no DOM: o store entrega a mídia do JsSIP a eles.
 */
@Component({
  selector: 'app-central-atendimento',
  standalone: true,
  imports: [DatePipe, CentralBuscaUnidadeComponent],
  host: { class: 'grid gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_340px] items-start' },
  template: `
    <!-- Centro: a chamada -->
    <section class="ps-panel" aria-label="Chamada em atendimento">
      @if (store.emChamada(); as c) {
        <div class="px-5 pt-5 pb-3">
          <p class="ps-label flex items-center gap-2">
            <span class="ps-dot" [class.ps-dot-ok]="store.estado() === 'em_chamada'" [class.ps-dot-warn]="store.estado() !== 'em_chamada'"></span>
            {{ titulo(c) }}
          </p>
          <h2 class="ps-h1 mt-2 truncate">{{ c.unidade || 'Portaria' }}</h2>
          <p class="text-sm mt-1 truncate">{{ c.condominio }}{{ c.portao ? ' · ' + c.portao : '' }}</p>
          @if (c.morador_nome) {
            <p class="ps-cap mt-0.5 truncate">{{ c.morador_nome }}</p>
          }
          <p class="ps-cap mt-1 tabular-nums" data-teste="situacao">{{ situacao() }}</p>
        </div>
      } @else {
        <div class="ps-empty" data-teste="sem-chamada">
          <p class="ps-h2">Nenhuma chamada em atendimento</p>
          <p class="ps-cap max-w-sm">Atenda uma chamada da fila ou ligue para uma unidade na aba Ligar.</p>
        </div>
      }

      <div class="relative bg-[var(--bg-000)] border-y border-[var(--line-100)]" [class.hidden]="!mostraVideo()">
        <video #video autoplay playsinline muted class="w-full aspect-video object-contain"></video>
        @if (fotoEnquantoConecta(); as foto) {
          <img [src]="foto" alt="Foto do visitante" class="absolute inset-0 w-full h-full object-contain" />
        }
      </div>
      <audio #audio autoplay class="hidden"></audio>

      @if (store.emChamada(); as c) {
        <div class="flex flex-wrap gap-2 px-5 py-4">
          @if (temPortao(c)) {
            <button type="button" class="ps-btn flex-1 disabled:opacity-40" [disabled]="!store.podeAbrir() || escolhendoMotivo()"
              (click)="escolhendoMotivo.set(true)">{{ store.abrindo() ? 'Abrindo…' : 'Abrir portão' }}</button>
          }
          <button type="button" class="ps-btn ps-btn-sec disabled:opacity-40" [disabled]="store.estado() !== 'em_chamada'" (click)="store.alternarMudo()">
            {{ store.mudo() ? 'Tirar mudo' : 'Mudo' }}
          </button>
          <button type="button" class="ps-btn ps-btn-danger" (click)="encerrar()">Encerrar</button>
        </div>

        @if (escolhendoMotivo()) {
          <form class="px-5 pb-5 space-y-3 border-t border-[var(--line-100)] pt-4" (submit)="$event.preventDefault(); confirmarAbrir()"
            aria-labelledby="titulo-motivo-abrir">
            <p id="titulo-motivo-abrir" class="ps-label">Motivo da abertura (vai para a auditoria)</p>
            <div class="grid gap-1.5 min-[640px]:grid-cols-2" role="radiogroup" aria-labelledby="titulo-motivo-abrir">
              @for (m of motivos; track m.codigo) {
                <label class="central-opcao flex items-center gap-2 px-3 py-2 cursor-pointer text-sm" [class.on]="motivo() === m.codigo">
                  <input type="radio" name="motivo-abrir" [value]="m.codigo" [checked]="motivo() === m.codigo" (change)="motivo.set(m.codigo)" />
                  {{ m.rotulo }}
                </label>
              }
            </div>
            @if (motivo() === 'outro') {
              <label class="block">
                <span class="ps-label">Descreva</span>
                <span class="ps-field mt-1.5">
                  <input type="text" name="detalhe-abrir" maxlength="255" [value]="detalhe()" (input)="detalhe.set($any($event.target).value)"
                    aria-label="Descreva o motivo da abertura" />
                </span>
              </label>
            }
            <div class="flex gap-2">
              <button type="submit" class="ps-btn flex-1 disabled:opacity-40" [disabled]="!podeConfirmar()">
                {{ store.abrindo() ? 'Abrindo…' : 'Confirmar e abrir' }}
              </button>
              <button type="button" class="ps-btn ps-btn-sec" (click)="cancelarMotivo()">Cancelar</button>
            </div>
          </form>
        }
      }
    </section>

    <!-- Direita: o contexto -->
    <aside class="ps-panel" aria-labelledby="titulo-contexto">
      <div class="ps-panel-head">
        <h2 id="titulo-contexto" class="ps-h2">Contexto</h2>
        @if (store.contextoEncerrado()) {
          <span class="flex items-center gap-2">
            <span class="ps-tag" data-teste="contexto-encerrado">Chamada encerrada</span>
            <button type="button" class="ps-btn ps-btn-ghost ps-btn-sm" (click)="store.fecharContexto()">Fechar</button>
          </span>
        }
      </div>
      @if (!store.chamadaDoContexto()) {
        <p class="ps-cap px-4 py-6">O contexto da chamada aparece aqui ao atender.</p>
      } @else if (store.contexto(); as ctx) {
        <div class="px-4 py-4 space-y-4 text-sm">
          @if (store.contextoEncerrado()) {
            <p class="ps-cap">A resposta do morador ao pedido continua chegando aqui por alguns minutos.</p>
          }
          <div>
            <p class="ps-label">Condomínio</p>
            <p class="mt-1">{{ ctx.condominio }}{{ ctx.portao ? ' · ' + ctx.portao : '' }}</p>
            <p class="ps-cap">{{ ctx.unidade || 'Visitante chamou a portaria (sem unidade)' }}</p>
          </div>
          <div>
            <p class="ps-label">Moradores</p>
            @if (ctx.moradores.length) {
              <p class="mt-1">{{ ctx.moradores.join(', ') }}</p>
            } @else {
              <p class="ps-cap mt-1">—</p>
            }
          </div>
          <div>
            <p class="ps-label">Esperados hoje</p>
            @if (ctx.esperados_hoje.length) {
              <ul class="mt-1 space-y-1" data-teste="esperados">
                @for (e of ctx.esperados_hoje; track $index) {
                  <li class="flex items-baseline gap-2">
                    <span class="ps-tag">{{ e.tipo === 'entrega' ? 'Entrega' : 'Convite' }}</span>
                    <span class="min-w-0 flex-1 truncate">{{ e.nome }}</span>
                    <span class="ps-cap tabular-nums">{{ e.horario ?? '' }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="ps-cap mt-1">Ninguém esperado hoje.</p>
            }
          </div>
          @if (ctx.instrucao_entregas) {
            <div>
              <p class="ps-label">Instruções de entregas</p>
              <p class="mt-1 whitespace-pre-line">{{ ctx.instrucao_entregas }}</p>
            </div>
          }

          <div class="border-t border-[var(--line-100)] pt-4" aria-live="polite">
            <p class="ps-label">Pedido ao morador</p>
            @if (ctx.pedido; as p) {
              <div class="mt-2 space-y-1" data-teste="pedido">
                <p class="flex items-center gap-2">
                  <span class="ps-dot" [class.ps-dot-warn]="p.estado === 'pendente'" [class.ps-dot-pulse]="p.estado === 'pendente'"
                    [class.ps-dot-ok]="p.estado === 'autorizado'" [class.ps-dot-danger]="p.estado === 'negado'"></span>
                  <span class="font-medium">{{ textoPedido(p) }}</span>
                </p>
                <p class="ps-cap">{{ p.nome_falado }}{{ p.motivo ? ' · ' + p.motivo : '' }}</p>
                @if (alcance(p); as a) {
                  <p class="ps-cap" [class.central-sem-alcance]="!!p.alcance && p.alcance.apps === 0" data-teste="alcance">{{ a }}</p>
                }
                @if (p.mensagem) {
                  <p class="mt-1">“{{ p.mensagem }}”</p>
                }
                @if (p.respondido_em) {
                  <p class="ps-cap tabular-nums">{{ p.respondido_em | date: 'HH:mm' }}</p>
                }
              </div>
            }
            @if (podeMostrarPedido() && (!ctx.pedido || ctx.pedido.estado !== 'pendente')) {
              <form class="mt-2 space-y-2" (submit)="$event.preventDefault(); pedir()">
                <span class="ps-field">
                  <input type="text" name="pedido-nome" maxlength="120" placeholder="Nome de quem está no portão" [value]="pedidoNome()"
                    (input)="pedidoNome.set($any($event.target).value)" aria-label="Nome de quem está no portão" />
                </span>
                <span class="ps-field">
                  <input type="text" name="pedido-motivo" maxlength="255" placeholder="Motivo (opcional)" [value]="pedidoMotivo()"
                    (input)="pedidoMotivo.set($any($event.target).value)" aria-label="Motivo do pedido" />
                </span>
                <span class="ps-field">
                  <select name="pedido-tipo" aria-label="Tipo do pedido" (change)="pedidoTipo.set($any($event.target).value)">
                    @for (t of tipos; track t.codigo) {
                      <option [value]="t.codigo" [selected]="pedidoTipo() === t.codigo">{{ t.rotulo }}</option>
                    }
                  </select>
                </span>
                @if (precisaUnidade()) {
                  <div>
                    <p class="ps-cap mb-1.5">{{ pedidoUnidade() ? 'Unidade: ' + pedidoUnidade()!.rotulo : 'Escolha a unidade que o visitante procura:' }}</p>
                    <app-central-busca-unidade
                      [idCondominio]="store.emChamada()!.id_condominio"
                      nome="pedido-unidade"
                      rotuloBusca="Buscar a unidade do pedido"
                      [selecionada]="pedidoUnidade()?.id ?? null"
                      (escolhida)="pedidoUnidade.set($event)" />
                  </div>
                }
                <button type="submit" class="ps-btn ps-btn-sec w-full disabled:opacity-40" [disabled]="!podePedir()">
                  {{ store.pedindo() ? 'Enviando…' : 'Pedir autorização ao morador' }}
                </button>
              </form>
            }
          </div>
        </div>
      } @else {
        <p class="ps-cap px-4 py-6">{{ store.carregandoContexto() ? 'Carregando o contexto…' : 'Contexto indisponível.' }}</p>
      }
    </aside>
  `,
  styles: [
    `
      .central-opcao {
        border: 1px solid var(--line-100);
      }
      .central-opcao.on {
        border-color: var(--ink);
      }
      .central-sem-alcance {
        color: var(--signal-danger);
      }
    `,
  ],
})
export class CentralAtendimentoComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly store = inject(CentralStore);
  readonly motivos = MOTIVOS_ABERTURA;
  readonly tipos = TIPOS_PEDIDO;

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly audio = viewChild.required<ElementRef<HTMLAudioElement>>('audio');

  readonly escolhendoMotivo = signal(false);
  readonly motivo = signal<MotivoAbertura | null>(null);
  readonly detalhe = signal('');

  readonly pedidoNome = signal('');
  readonly pedidoMotivo = signal('');
  readonly pedidoTipo = signal<TipoPedido>('visita');
  readonly pedidoUnidade = signal<UnidadeCentral | null>(null);

  private readonly agora = signal(Date.now());
  private relogio: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Chamada nova (ou fim da chamada): os formulários recomeçam.
    effect(() => {
      this.store.emChamada()?.id;
      untracked(() => this.limparFormularios());
    });
  }

  readonly mostraVideo = computed(() => {
    const c = this.store.emChamada();
    return !!c && this.temPortao(c);
  });

  readonly fotoEnquantoConecta = computed(() => {
    const c = this.store.emChamada();
    return c?.foto_url && this.store.estado() !== 'em_chamada' ? c.foto_url : null;
  });

  readonly podeConfirmar = computed(
    () => this.store.podeAbrir() && !!this.motivo() && (this.motivo() !== 'outro' || !!this.detalhe().trim()),
  );

  /** Pedido ao morador: só com a chamada em curso e com portão (o morador autoriza e o portão abre). */
  readonly podeMostrarPedido = computed(() => {
    const c = this.store.emChamada();
    return !!c && this.temPortao(c);
  });

  /** Chamada da portaria (o visitante discou a portaria): o pedido precisa da unidade. */
  readonly precisaUnidade = computed(() => {
    const c = this.store.emChamada();
    return !!c && !c.unidade;
  });

  readonly podePedir = computed(
    () => !this.store.pedindo() && !!this.pedidoNome().trim() && (!this.precisaUnidade() || !!this.pedidoUnidade()),
  );

  readonly situacao = computed(() => {
    const c = this.store.emChamada();
    if (!c) return '';
    if (this.store.estado() !== 'em_chamada') return c.saindo ? 'Chamando…' : 'Conectando…';
    const inicio = this.store.inicioConversa();
    const d = inicio ? Math.max(0, Math.floor((this.agora() - inicio) / 1000)) : 0;
    const texto = `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
    return d >= AVISO_FIM_S ? `${texto} · encerra em ${Math.max(0, MAX_CONVERSA_S - d)} s` : texto;
  });

  temPortao(c: ChamadaEmCurso): boolean {
    return c.tipo === 'facial_unidade' || c.tipo === 'facial_portaria';
  }

  titulo(c: ChamadaEmCurso): string {
    if (c.tipo === 'portaria_unidade') return 'Ligando para a unidade';
    return motivoCentral(c);
  }

  textoPedido(p: PedidoResumo): string {
    return textoDoPedido(p);
  }

  alcance(p: PedidoResumo): string | null {
    return textoDoAlcance(p);
  }

  async confirmarAbrir(): Promise<void> {
    const m = this.motivo();
    if (!m || !this.podeConfirmar()) return;
    // O detalhe só vale para "outro" (o campo só aparece nele).
    const ok = await this.store.abrir(m, m === 'outro' ? this.detalhe() : undefined);
    if (ok) this.cancelarMotivo();
  }

  cancelarMotivo(): void {
    this.escolhendoMotivo.set(false);
    this.motivo.set(null);
    this.detalhe.set('');
  }

  async pedir(): Promise<void> {
    if (!this.podePedir()) return;
    const ok = await this.store.pedirAutorizacao(
      this.pedidoNome(),
      this.pedidoMotivo(),
      this.pedidoTipo(),
      this.precisaUnidade() ? this.pedidoUnidade()?.id : undefined,
    );
    if (ok) {
      this.pedidoNome.set('');
      this.pedidoMotivo.set('');
    }
  }

  encerrar(): void {
    this.store.encerrar();
    this.limparFormularios();
  }

  ngOnInit(): void {
    this.relogio = setInterval(() => {
      if (this.store.inicioConversa() !== null) this.agora.set(Date.now());
    }, 1000);
  }

  ngAfterViewInit(): void {
    this.store.registrarMidia(this.video().nativeElement, this.audio().nativeElement);
  }

  ngOnDestroy(): void {
    if (this.relogio) clearInterval(this.relogio);
    this.store.registrarMidia(null, null);
  }

  private limparFormularios(): void {
    this.cancelarMotivo();
    this.pedidoNome.set('');
    this.pedidoMotivo.set('');
    this.pedidoTipo.set('visita');
    this.pedidoUnidade.set(null);
  }
}
