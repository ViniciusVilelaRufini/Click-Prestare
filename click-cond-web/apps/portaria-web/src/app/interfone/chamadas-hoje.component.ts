import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, of, switchMap } from 'rxjs';
import { ChamadaHoje, InterfoneApi } from './interfone.api';
import { InterfoneStore } from './interfone.store';
import { FotoChamadaComponent } from './foto-chamada.component';
import { FiltroChamadas, GrupoResultado, contar, filtrar, grupo, limitesData, rotuloResultado, rotuloTipo } from './interfone-lista';

export { rotuloResultado } from './interfone-lista';

const CARTOES: { id: FiltroChamadas; rotulo: string; ponto: string; tom: string }[] = [
  { id: 'todas', rotulo: 'Total', ponto: 'ps-dot-ink', tom: '' },
  { id: 'atendidas', rotulo: 'Atendidas', ponto: 'ps-dot-ok', tom: '' },
  { id: 'sem_resposta', rotulo: 'Sem resposta', ponto: 'ps-dot-warn', tom: 'ps-tone-warn' },
  { id: 'falhas', rotulo: 'Falhas', ponto: 'ps-dot-danger', tom: 'ps-tone-danger' },
  { id: 'portoes', rotulo: 'Portões abertos', ponto: 'ps-dot-ok', tom: '' },
];

const PONTO: Record<GrupoResultado, string> = {
  atendida: 'ps-dot-ok',
  sem_resposta: 'ps-dot-warn',
  falha: 'ps-dot-danger',
  andamento: 'ps-dot-ink ps-dot-pulse',
};

/**
 * Chamadas do interfone do condomínio: números do dia (que também filtram), a lista com resultado colorido, ligar de
 * volta, foto ampliada e dias anteriores (até 30 dias, sem atualização ao vivo). Hoje vem do `store.hoje`, que segue
 * reconciliando o toque; outro dia vem de `GET /interfone/portaria/dia` e fica só nesta tela.
 */
@Component({
  selector: 'app-chamadas-hoje',
  standalone: true,
  host: { class: 'block' },
  imports: [DatePipe, FotoChamadaComponent],
  template: `
    <section class="ps-panel" aria-labelledby="titulo-chamadas-hoje">
      <div class="ps-panel-head !flex-wrap gap-3">
        <h2 id="titulo-chamadas-hoje" class="ps-h2">{{ data() ? 'Chamadas de ' + rotuloData(data()!) : 'Chamadas de hoje' }}</h2>
        <label class="ps-field !h-9 !gap-2 !px-2.5" title="Ver outro dia">
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>
          <input type="date" name="dia-chamadas" aria-label="Dia das chamadas" class="text-sm text-[var(--ink)]"
            [min]="limites().min" [max]="limites().max" [value]="data() ?? limites().max"
            (change)="trocarData($any($event.target).value)" />
        </label>
      </div>

      @if (data()) {
        <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-[var(--line-100)] bg-[var(--bg-300)]" data-teste="faixa-dia">
          <p class="ps-cap">Vendo {{ rotuloData(data()!) }} · sem atualização ao vivo</p>
          <button type="button" class="ps-btn ps-btn-ghost ps-btn-sm" (click)="voltarHoje()">Voltar para hoje</button>
        </div>
      }

      <div class="ps-kpis !border-x-0 !border-t-0 !grid-cols-2 min-[700px]:!grid-cols-5" role="group" aria-label="Filtrar chamadas">
        @for (k of cartoes; track k.id) {
          <button type="button" [class]="'ps-kpi !px-4 !py-3 !gap-1.5 text-left ' + k.tom + (filtro() === k.id && k.id !== 'todas' ? ' outline outline-1 -outline-offset-1 [outline-color:var(--ink)]' : '')"
            [attr.aria-pressed]="filtro() === k.id" [attr.data-filtro]="k.id" (click)="alternar(k.id)">
            <span class="ps-label flex items-center gap-2 truncate"><span [class]="'ps-dot ' + k.ponto"></span>{{ k.rotulo }}</span>
            <span class="text-[28px] leading-8 font-light tabular-nums [font-family:var(--font-display)]">{{ numeros()[k.id] }}</span>
          </button>
        }
      </div>

      @if (erroDia()) {
        <p role="alert" class="px-4 py-2 text-sm text-[var(--ink-muted)] border-b border-[var(--line-100)]">{{ erroDia() }}</p>
      }

      <div class="overflow-y-auto max-h-[calc(100dvh-22rem)] min-h-[12rem]" data-teste="lista-chamadas-hoje" [attr.aria-busy]="carregando()">
      @if (carregando()) {
        <p class="px-4 py-6 text-center text-sm text-[var(--ink-muted)]">Carregando…</p>
      } @else {
      @for (c of visiveis(); track c.id) {
        <div class="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--line-100)] last:border-b-0" data-teste="chamada">
          <span class="w-10 shrink-0 text-sm tabular-nums text-[var(--ink-muted)]">{{ c.inicio | date: 'HH:mm' }}</span>
          @if (c.foto_url) {
            <button type="button" class="shrink-0 block w-10 h-10 border border-[var(--line-200)] hover:border-[var(--ink)] transition-colors"
              [attr.aria-label]="'Ampliar a foto do visitante de ' + c.unidade" (click)="foto.set(c)" data-teste="abrir-foto">
              <img [src]="c.foto_url" alt="" class="w-full h-full object-cover" loading="lazy" />
            </button>
          } @else {
            <span class="ps-avatar shrink-0 !w-10 !h-10" aria-hidden="true">
              @switch (c.tipo) {
                @case ('unidade_portaria') {
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>
                }
                @case ('facial_unidade') {
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>
                }
                @default {
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106a1.125 1.125 0 00-1.173.417l-.97 1.293a12.035 12.035 0 01-7.143-7.143l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>
                }
              }
            </span>
          }
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">{{ c.unidade }}</p>
            <p class="ps-cap truncate">{{ tipo(c) }}@if (c.atendida_por_nome) { · {{ c.atendida_por_nome }}}</p>
            @if (c.porta_aberta) {
              <p class="ps-cap flex items-center gap-1.5 truncate"><span class="ps-dot ps-dot-ok"></span>Portão aberto@if (c.porta_aberta_por_nome) { por {{ c.porta_aberta_por_nome }}}</p>
            }
          </div>
          <span class="ps-tag shrink-0 max-[560px]:hidden" data-teste="resultado"><span [class]="'ps-dot ' + ponto(c)"></span>{{ resultado(c) }}</span>
          @if (c.id_apartamento != null) {
            <button type="button" class="ps-btn ps-btn-sec ps-btn-sm shrink-0 disabled:opacity-40" [disabled]="ocupado()"
              [attr.aria-label]="'Ligar de volta para ' + c.unidade" (click)="ligar(c)">Ligar</button>
          }
        </div>
      } @empty {
        <p class="px-4 py-6 text-center text-sm text-[var(--ink-muted)]">
          {{ filtro() !== 'todas' ? 'Nenhuma chamada neste filtro.' : data() ? 'Nenhuma chamada neste dia.' : 'Nenhuma chamada hoje.' }}
        </p>
      }
      }
      </div>
    </section>

    @if (foto(); as f) {
      <app-foto-chamada [chamada]="f" (fechar)="foto.set(null)" />
    }
  `,
})
export class ChamadasHojeComponent {
  readonly store = inject(InterfoneStore);
  private readonly api = inject(InterfoneApi);

  readonly cartoes = CARTOES;
  readonly filtro = signal<FiltroChamadas>('todas');
  /** Dia escolhido (AAAA-MM-DD); null = hoje, ao vivo. */
  readonly data = signal<string | null>(null);
  readonly doDia = signal<ChamadaHoje[]>([]);
  readonly carregando = signal(false);
  readonly erroDia = signal<string | null>(null);
  readonly foto = signal<ChamadaHoje | null>(null);

  readonly lista = computed(() => (this.data() ? this.doDia() : this.store.hoje()));
  readonly numeros = computed(() => contar(this.lista()));
  readonly visiveis = computed(() => filtrar(this.lista(), this.filtro()));
  readonly ocupado = computed(() => !!this.store.emChamada() || this.store.discando() || this.store.atendendo() !== null);

  private readonly dias = new Subject<string | null>();

  constructor() {
    this.dias
      .pipe(
        // switchMap: trocar de dia de novo descarta a resposta do dia anterior.
        switchMap((d) => (d ? this.api.dia(d).pipe(catchError(() => of(undefined))) : of(null))),
        takeUntilDestroyed(),
      )
      .subscribe((r) => {
        this.carregando.set(false);
        if (r === null) return;
        if (r === undefined) {
          this.erroDia.set('Não foi possível carregar as chamadas desse dia.');
          return;
        }
        this.doDia.set(Array.isArray(r) ? r : []);
      });
  }

  /** Recalculado a cada uso: a página pode ficar aberta depois da meia-noite. */
  limites(): { min: string; max: string } {
    return limitesData(new Date());
  }

  trocarData(valor: string): void {
    const { min, max } = this.limites();
    if (!valor || valor === max || valor < min || valor > max) {
      this.voltarHoje();
      return;
    }
    this.data.set(valor);
    this.doDia.set([]);
    this.erroDia.set(null);
    this.carregando.set(true);
    this.dias.next(valor);
  }

  voltarHoje(): void {
    this.data.set(null);
    this.doDia.set([]);
    this.erroDia.set(null);
    this.carregando.set(false);
    this.dias.next(null);
  }

  alternar(f: FiltroChamadas): void {
    this.filtro.set(this.filtro() === f ? 'todas' : f);
  }

  ligar(c: ChamadaHoje): void {
    if (c.id_apartamento == null || this.ocupado()) return;
    void this.store.ligar(c.id_apartamento, c.unidade);
  }

  rotuloData(d: string): string {
    const [, m, dia] = d.split('-');
    return `${dia}/${m}`;
  }

  tipo(c: ChamadaHoje): string {
    return rotuloTipo(c);
  }

  resultado(c: ChamadaHoje): string {
    return rotuloResultado(c);
  }

  ponto(c: ChamadaHoje): string {
    return PONTO[grupo(c)];
  }
}
