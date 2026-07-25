import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CountUpDirective } from '../count-up.directive';

/**
 * Card de KPI padronizado: label (11px caps) → valor (mono, count-up) → delta
 * opcional + sparkline opcional. Clicável quando [clicavel]="true".
 *
 * Uso:
 *   <app-kpi-card label="MRR" [valor]="ov.mrrTotal" formato="moeda"
 *     [delta]="12" [sparkline]="[3,4,5,6]" [clicavel]="true" (cardClick)="abrir()" />
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
      <p class="stat-label">{{ label }}</p>
      <p class="stat-value mt-2">
        <span [countUp]="valor" [countUpFormat]="formato">{{ valor }}</span>{{ sufixo }}
      </p>
      <div class="mt-2 flex items-end justify-between gap-2">
        @if (delta !== null) {
          <span class="badge" [ngClass]="delta >= 0 ? 'badge-success' : 'badge-danger'">
            {{ delta >= 0 ? '▲' : '▼' }} {{ deltaAbs() }}%
          </span>
        } @else if (detalhe) {
          <span class="text-xs text-ink-soft">{{ detalhe }}</span>
        } @else {
          <span></span>
        }
        @if (pontos().length > 1) {
          <svg class="h-9 w-[120px] shrink-0 overflow-visible" viewBox="0 0 120 36" aria-hidden="true">
            <path [attr.d]="paths().area" fill="currentColor" class="text-accent/10"></path>
            <path [attr.d]="paths().line" fill="none" stroke="currentColor" stroke-width="1.5" class="text-accent"></path>
          </svg>
        }
      </div>
    </div>
  `,
})
export class KpiCardComponent {
  @Input({ required: true }) label = '';
  @Input({ required: true }) valor = 0;
  @Input() formato: 'moeda' | 'int' | 'pct' = 'int';
  @Input() sufixo = '';
  @Input() delta: number | null = null;
  @Input() detalhe = '';
  @Input() set sparkline(v: number[] | null) { this.pontos.set(v ?? []); }
  @Input() clicavel = false;
  @Output() cardClick = new EventEmitter<void>();

  readonly pontos = signal<number[]>([]);

  deltaAbs(): number {
    return Math.abs(this.delta ?? 0);
  }

  readonly paths = computed(() => {
    const valores = this.pontos();
    if (!valores || valores.length < 2) return { line: '', area: '' };
    const width = 120;
    const height = 36;
    const maxVal = Math.max(...valores);
    const minVal = Math.min(...valores);
    const range = maxVal === minVal ? 1 : maxVal - minVal;

    const pts = valores.map((val, idx) => {
      const x = (idx / (valores.length - 1)) * width;
      const y = height - 2 - ((val - minVal) / range) * (height - 4);
      return { x, y };
    });

    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L ${width} ${height} L 0 ${height} Z`;
    return { line, area };
  });
}
