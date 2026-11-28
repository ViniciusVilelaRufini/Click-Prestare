import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { AlertaCentral } from './central-api';
import { CentralStore } from './central.store';

/** Nome do tipo de alerta do Guarita (e dos eventos de porta, quando vierem). */
export function tipoDoAlerta(tipo: string): string {
  switch (tipo) {
    case 'panico':
      return 'Pânico';
    case 'porta_aberta':
      return 'Porta aberta';
    case 'porta_forcada':
    case 'arrombamento':
      return 'Porta forçada';
    default:
      return 'Alerta';
  }
}

/** Alertas abertos de todos os condomínios da central. Pânico toca a sirene até alguém marcar "visto". */
@Component({
  selector: 'app-central-alertas',
  standalone: true,
  imports: [DatePipe],
  host: { class: 'block' },
  template: `
    <section class="ps-panel" aria-labelledby="titulo-alertas-central">
      <div class="ps-panel-head">
        <h2 id="titulo-alertas-central" class="ps-h2 flex items-center gap-2">
          @if (store.somAlerta()) {
            <span class="ps-dot ps-dot-danger ps-dot-pulse"></span>
          }
          Alertas
        </h2>
        <span class="ps-cap tabular-nums">{{ store.alertasAbertos().length }} {{ store.alertasAbertos().length === 1 ? 'aberto' : 'abertos' }}</span>
      </div>
      @if (store.alertasAbertos().length === 0) {
        <p class="ps-cap px-4 py-6 text-center">Nenhum alerta aberto.</p>
      }
      <ul class="max-h-[40vh] overflow-y-auto">
        @for (a of store.alertasAbertos(); track a.id) {
          <li
            class="px-4 py-3 border-b border-[var(--line-100)] last:border-b-0"
            [class.central-panico]="a.tipo === 'panico'"
            [attr.role]="a.tipo === 'panico' ? 'alert' : null"
          >
            <div class="flex items-start gap-3">
              <span class="ps-dot mt-1.5" [class.ps-dot-danger]="a.tipo === 'panico'" [class.ps-dot-pulse]="a.tipo === 'panico'" [class.ps-dot-warn]="a.tipo !== 'panico'"></span>
              <div class="min-w-0 flex-1">
                <p class="ps-label truncate" [class.central-panico-txt]="a.tipo === 'panico'">{{ tipo(a) }} · {{ a.condominio }}</p>
                <p class="text-sm mt-1">{{ a.descricao }}</p>
                <p class="ps-cap mt-0.5 tabular-nums">{{ a.created_at | date: 'dd/MM HH:mm' }}</p>
              </div>
              <button
                type="button"
                class="ps-btn ps-btn-sm shrink-0 disabled:opacity-40"
                [class.ps-btn-danger]="a.tipo === 'panico'"
                [class.ps-btn-sec]="a.tipo !== 'panico'"
                [disabled]="store.marcando().has(a.id)"
                [attr.aria-label]="'Marcar como visto: ' + tipo(a) + ' em ' + a.condominio"
                (click)="store.marcarVisto(a.id)"
              >{{ store.marcando().has(a.id) ? 'Marcando…' : 'Visto' }}</button>
            </div>
          </li>
        }
      </ul>
    </section>
  `,
  styles: [
    `
      .central-panico {
        background: color-mix(in srgb, var(--signal-danger) 12%, transparent);
      }
      .central-panico-txt {
        color: var(--signal-danger);
      }
    `,
  ],
})
export class CentralAlertasComponent {
  readonly store = inject(CentralStore);

  tipo(a: AlertaCentral): string {
    return tipoDoAlerta(a.tipo);
  }
}
