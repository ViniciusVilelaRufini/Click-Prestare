import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import type { ChamadaCentral } from './central-api';
import { CentralStore } from './central.store';

/** Texto do motivo da chamada na fila da central. */
export function motivoCentral(c: Pick<ChamadaCentral, 'tipo' | 'motivo'>): string {
  if (c.tipo === 'unidade_portaria') return 'Morador ligando para a portaria';
  if (c.tipo === 'facial_portaria') return 'Visitante chamou a portaria';
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

/** "agora", "40 s", "3 min" desde `iso`. */
export function haQuanto(iso: string, agora: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((agora - t) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min`;
}

/** Fila de chamadas esperando a central (todos os condomínios), mais antiga primeiro. */
@Component({
  selector: 'app-central-fila',
  standalone: true,
  host: { class: 'block' },
  template: `
    <section class="ps-panel" aria-labelledby="titulo-fila-central">
      <div class="ps-panel-head">
        <h2 id="titulo-fila-central" class="ps-h2 flex items-center gap-2">
          @if (store.fila().length) {
            <span class="ps-dot ps-dot-warn ps-dot-pulse"></span>
          }
          Fila
        </h2>
        <span class="ps-cap tabular-nums" data-teste="total-fila">{{ store.fila().length }} {{ store.fila().length === 1 ? 'chamada' : 'chamadas' }}</span>
      </div>
      @if (store.fila().length === 0) {
        <p class="ps-cap px-4 py-6 text-center" data-teste="fila-vazia">Nenhuma chamada esperando.</p>
      }
      <ul class="max-h-[50vh] overflow-y-auto">
        @for (c of store.fila(); track c.id) {
          <li class="flex items-start gap-3 px-4 py-3 border-b border-[var(--line-100)] last:border-b-0" [attr.aria-label]="'Chamada de ' + c.condominio">
            @if (c.foto_url) {
              <img [src]="c.foto_url" alt="Foto do visitante" class="w-14 h-14 object-cover border border-[var(--line-200)] shrink-0" />
            } @else {
              <div class="w-14 h-14 shrink-0 border border-[var(--line-100)] bg-[var(--bg-200)] flex items-center justify-center" aria-hidden="true">
                <svg class="w-5 h-5 text-[var(--ink-subtle)]" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106a1.125 1.125 0 00-1.173.417l-.97 1.293a1.125 1.125 0 01-1.21.38 12.035 12.035 0 01-7.143-7.143 1.125 1.125 0 01.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102A1.125 1.125 0 005.872 2.25H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>
              </div>
            }
            <div class="min-w-0 flex-1">
              <p class="ps-label truncate">{{ c.condominio }}</p>
              <p class="text-sm font-medium mt-1 truncate">{{ c.unidade || 'Portaria' }}</p>
              <p class="ps-cap mt-0.5 truncate">{{ motivo(c) }}{{ c.portao ? ' · ' + c.portao : '' }}</p>
              @if (c.morador_nome) {
                <p class="ps-cap truncate">{{ c.morador_nome }}</p>
              }
            </div>
            <div class="flex flex-col items-end gap-2 shrink-0">
              <span class="ps-cap tabular-nums">{{ ha(c.criada_em) }}</span>
              <button
                type="button"
                class="ps-btn ps-btn-sm disabled:opacity-40"
                [disabled]="store.ocupado()"
                [attr.aria-label]="'Atender ' + c.condominio + ' ' + (c.unidade || 'portaria')"
                (click)="store.atender(c.id)"
              >{{ store.atendendo() === c.id ? 'Atendendo…' : 'Atender' }}</button>
            </div>
          </li>
        }
      </ul>
    </section>
  `,
})
export class CentralFilaComponent implements OnInit, OnDestroy {
  readonly store = inject(CentralStore);
  private readonly agora = signal(Date.now());
  private relogio: ReturnType<typeof setInterval> | null = null;

  motivo(c: ChamadaCentral): string {
    return motivoCentral(c);
  }

  ha(iso: string): string {
    return haQuanto(iso, this.agora());
  }

  ngOnInit(): void {
    this.relogio = setInterval(() => this.agora.set(Date.now()), 5_000);
  }

  ngOnDestroy(): void {
    if (this.relogio) clearInterval(this.relogio);
  }
}
