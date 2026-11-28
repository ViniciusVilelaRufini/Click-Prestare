import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ChamadaConsole, InterfoneStore } from './interfone.store';

/** Texto do motivo da chamada que chegou à portaria. */
export function motivoDaChamada(c: Pick<ChamadaConsole, 'tipo' | 'motivo'>): string {
  if (c.tipo === 'unidade_portaria') return 'Morador ligando';
  switch (c.motivo) {
    case 'nao_atendeu':
      return 'Morador não atendeu';
    case 'recusou':
      return 'Morador recusou';
    case 'sem_app':
      return 'Ninguém da unidade recebe chamadas';
    default:
      return 'Visitante no portão';
  }
}

const AVISO_FIM_S = 150;
const MAX_CONVERSA_S = 180;

/**
 * Painel fixo do interfone no console da portaria (montado no shell). Só aparece para login de porteiro com o
 * módulo ligado — quem decide é o InterfoneStore. Mostra as chamadas tocando (transferidas do apartamento ou do
 * morador ligando), a chamada em andamento com o vídeo do facial, e o aviso quando este console não vai tocar
 * (microfone negado, central desconectada).
 */
@Component({
  selector: 'app-painel-chamada',
  standalone: true,
  template: `
    <div
      class="fixed top-3 right-4 left-4 min-[900px]:left-auto min-[900px]:w-[380px] z-[45] flex flex-col gap-2 pointer-events-none"
      [class.hidden]="!visivel()"
    >
      @if (store.ativo()) {
        <div data-painel-interfone class="contents">
          @if (store.semChamadas(); as motivo) {
            <div role="alert" class="ps-panel pointer-events-auto flex items-start gap-2.5 px-4 py-3">
              <span class="ps-dot ps-dot-danger mt-1.5"></span>
              <p class="text-sm text-[var(--ink-muted)]">{{ motivo }}</p>
            </div>
          }

          @for (c of store.tocando(); track c.id) {
            <section class="ps-panel pointer-events-auto" [attr.aria-label]="'Chamada do interfone: ' + c.unidade">
              <div class="flex items-start gap-3 px-4 pt-4 pb-3">
                @if (c.foto_url) {
                  <img [src]="c.foto_url" alt="Foto do visitante" class="w-16 h-16 object-cover border border-[var(--line-200)] shrink-0" />
                }
                <div class="min-w-0 flex-1">
                  <p class="ps-label flex items-center gap-2"><span class="ps-dot ps-dot-warn ps-dot-pulse"></span>{{ c.tipo === 'unidade_portaria' ? 'Interfone · Morador' : 'Interfone · Portão' }}</p>
                  <h2 class="ps-h2 mt-1.5 truncate">{{ c.unidade }}</h2>
                  <p class="ps-cap mt-1">{{ motivoDe(c) }}</p>
                  @if (c.morador_nome) {
                    <p class="text-sm mt-0.5 truncate">{{ c.morador_nome }}</p>
                  }
                </div>
              </div>
              <div class="flex gap-2 px-4 pb-4">
                <button
                  type="button"
                  class="ps-btn flex-1 disabled:opacity-40"
                  [disabled]="!!store.emChamada() || store.atendendo() !== null || store.discando()"
                  (click)="store.atender(c.id)"
                >{{ store.atendendo() === c.id ? 'Atendendo…' : 'Atender' }}</button>
              </div>
            </section>
          }
        </div>
      }

      <section class="ps-panel pointer-events-auto" [class.hidden]="!store.emChamada()" aria-label="Chamada em andamento">
        @if (store.emChamada(); as c) {
          <div class="px-4 pt-4 pb-3">
            <p class="ps-label flex items-center gap-2">
              <span class="ps-dot" [class.ps-dot-ok]="store.estado() === 'em_chamada'" [class.ps-dot-warn]="store.estado() !== 'em_chamada'"></span>
              {{ tituloEmChamada(c) }}
            </p>
            <h2 class="ps-h2 mt-1.5 truncate">{{ c.unidade }}</h2>
            @if (c.morador_nome) {
              <p class="text-sm mt-0.5 truncate">{{ c.morador_nome }}</p>
            }
            <p class="ps-cap mt-1 tabular-nums">{{ situacao() }}</p>
          </div>
        }
        <div class="relative bg-[var(--bg-000)] border-y border-[var(--line-100)]" [class.hidden]="!mostraVideo()">
          <video #video autoplay playsinline muted class="w-full aspect-video object-contain"></video>
          @if (fotoEnquantoConecta(); as foto) {
            <img [src]="foto" alt="Foto do visitante" class="absolute inset-0 w-full h-full object-contain" />
          }
        </div>
        @if (store.emChamada(); as c) {
          <div class="flex flex-wrap gap-2 px-4 py-4">
            @if (c.tipo === 'facial_unidade' && store.estado() === 'em_chamada') {
              <button type="button" class="ps-btn flex-1 disabled:opacity-40" [disabled]="!store.podeAbrir()" (click)="store.abrir()">
                {{ store.abrindo() ? 'Abrindo…' : 'Abrir portão' }}
              </button>
            }
            <button type="button" class="ps-btn ps-btn-sec disabled:opacity-40" [disabled]="store.estado() !== 'em_chamada'" (click)="store.alternarMudo()">
              {{ store.mudo() ? 'Tirar mudo' : 'Mudo' }}
            </button>
            <button type="button" class="ps-btn ps-btn-danger" (click)="store.encerrar()">Encerrar</button>
          </div>
        }
      </section>

      @if (store.aviso() || store.erro()) {
        <div role="status" class="ps-panel pointer-events-auto flex items-start gap-2.5 px-4 py-3">
          <span class="ps-dot mt-1.5" [class.ps-dot-danger]="!!store.erro() && !store.aviso()" [class.ps-dot-ink]="!!store.aviso()"></span>
          <p class="text-sm flex-1">{{ store.aviso() ?? store.erro() }}</p>
          <button type="button" class="ps-ibtn -mr-2 -mt-1" aria-label="Fechar aviso" (click)="fecharAviso()">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      }

      <audio #audio autoplay class="hidden"></audio>
    </div>
  `,
})
export class PainelChamadaComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly store = inject(InterfoneStore);

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly audio = viewChild.required<ElementRef<HTMLAudioElement>>('audio');

  /** Relógio do contador (gravado por timer: zoneless). */
  private readonly agora = signal(Date.now());
  private relogio: ReturnType<typeof setInterval> | null = null;

  readonly visivel = computed(
    () =>
      this.store.ativo() &&
      (this.store.tocando().length > 0 ||
        !!this.store.emChamada() ||
        !!this.store.semChamadas() ||
        !!this.store.aviso() ||
        !!this.store.erro()),
  );

  readonly mostraVideo = computed(() => this.store.emChamada()?.tipo === 'facial_unidade');

  /** A foto do visitante cobre o vídeo até a conversa começar. */
  readonly fotoEnquantoConecta = computed(() => {
    const c = this.store.emChamada();
    return c?.foto_url && this.store.estado() !== 'em_chamada' ? c.foto_url : null;
  });

  readonly duracaoS = computed(() => {
    const inicio = this.store.inicioConversa();
    return inicio ? Math.max(0, Math.floor((this.agora() - inicio) / 1000)) : 0;
  });

  readonly situacao = computed(() => {
    const c = this.store.emChamada();
    if (!c) return '';
    if (this.store.estado() !== 'em_chamada') return c.saindo ? 'Chamando…' : 'Conectando…';
    const d = this.duracaoS();
    const texto = `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
    return d >= AVISO_FIM_S ? `${texto} · encerra em ${Math.max(0, MAX_CONVERSA_S - d)} s` : texto;
  });

  motivoDe(c: ChamadaConsole): string {
    return motivoDaChamada(c);
  }

  tituloEmChamada(c: ChamadaConsole): string {
    if (c.tipo === 'portaria_unidade') return 'Interfone · Ligando para';
    if (c.tipo === 'unidade_portaria') return 'Interfone · Morador';
    return 'Interfone · Portão';
  }

  fecharAviso(): void {
    this.store.aviso.set(null);
    this.store.erro.set(null);
  }

  ngOnInit(): void {
    this.store.iniciar();
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
    this.store.parar();
  }
}
