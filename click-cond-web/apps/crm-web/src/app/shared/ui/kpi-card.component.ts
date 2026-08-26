import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CountUpDirective } from '../count-up.directive';

/**
 * Card de KPI no formato do kit: tile de ícone tintado + rótulo na primeira
 * linha, valor grande (count-up) na segunda e, na terceira, o delta e o
 * detalhe. Clicável quando [clicavel]="true".
 *
 * Sem gráfico embutido de propósito: o card precisa ter a mesma silhueta em
 * toda a grade, e a série temporal vive nos gráficos dedicados da página.
 *
 * Uso:
 *   <app-kpi-card label="MRR" [valor]="ov.mrrTotal" formato="moeda" tom="green"
 *     [icone]="ICONES.moeda" [delta]="12" [clicavel]="true" (cardClick)="abrir()" />
 */
@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [CommonModule, CountUpDirective],
  template: `
    <div
      class="card kpi-card p-5"
      [class.cursor-pointer]="clicavel"
      [class.press]="clicavel"
      [attr.role]="clicavel ? 'button' : null"
      [attr.tabindex]="clicavel ? 0 : null"
      (click)="clicavel && cardClick.emit()"
      (keydown.enter)="clicavel && cardClick.emit()"
    >
      <div class="flex items-center gap-3">
        <div class="tile" [ngClass]="tileClasse()">
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="icone || ICONE_PADRAO" />
          </svg>
        </div>
        <p class="min-w-0 flex-1 truncate text-sm font-medium text-ink-soft">{{ label }}</p>
      </div>

      <p class="stat-value mt-4">
        <span [countUp]="valor" [countUpFormat]="formato">{{ valor }}</span>{{ sufixo }}
      </p>

      <div class="mt-2 flex min-w-0 items-center gap-2">
        @if (delta !== null) {
          <span class="badge shrink-0" [ngClass]="delta >= 0 ? 'badge-success' : 'badge-danger'">
            {{ delta >= 0 ? '↗' : '↘' }} {{ deltaAbs() }}%
          </span>
        }
        @if (detalhe) {
          <span class="truncate text-xs text-ink-muted">{{ detalhe }}</span>
        }
      </div>
    </div>
  `,
})
export class KpiCardComponent {
  /** Ícone padrão (gráfico) quando o chamador não informa um. */
  readonly ICONE_PADRAO = 'M3 3v18h18M7 14l3-3 3 3 5-5';

  @Input({ required: true }) label = '';
  @Input({ required: true }) valor = 0;
  @Input() formato: 'moeda' | 'int' | 'pct' = 'int';
  @Input() sufixo = '';
  @Input() delta: number | null = null;
  @Input() detalhe = '';
  /** Path SVG (viewBox 24) do ícone exibido no tile. */
  @Input() icone = '';
  /** Tinta do tile — segue a paleta cromática do design system. */
  @Input() tom: 'green' | 'beige' | 'purple' | 'tosca' | 'dark' = 'green';
  @Input() clicavel = false;
  @Output() cardClick = new EventEmitter<void>();

  tileClasse(): string {
    return `tile-${this.tom}`;
  }

  deltaAbs(): number {
    return Math.abs(this.delta ?? 0);
  }
}
