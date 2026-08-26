import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CountUpDirective } from '../count-up.directive';

/**
 * Card de KPI no formato do kit: tile de ícone tintado + rótulo na primeira
 * linha, valor grande (count-up) na segunda e, na terceira, delta ou detalhe
 * com sparkline opcional à direita. Clicável quando [clicavel]="true".
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

      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          @if (delta !== null) {
            <span class="badge" [ngClass]="delta >= 0 ? 'badge-success' : 'badge-danger'">
              {{ delta >= 0 ? '↗' : '↘' }} {{ deltaAbs() }}%
            </span>
          }
          @if (detalhe) {
            <span class="truncate text-xs text-ink-muted">{{ detalhe }}</span>
          }
        </div>
        @if (pontos().length > 1) {
          <svg class="h-7 w-[72px] shrink-0 overflow-visible" [ngClass]="tracoClasse()" viewBox="0 0 72 28" aria-hidden="true">
            <path [attr.d]="paths().area" fill="currentColor" opacity="0.12"></path>
            <path [attr.d]="paths().line" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
          </svg>
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
  @Input() set sparkline(v: number[] | null) { this.pontos.set(v ?? []); }
  @Input() clicavel = false;
  @Output() cardClick = new EventEmitter<void>();

  readonly pontos = signal<number[]>([]);

  tileClasse(): string {
    return `tile-${this.tom === 'green' ? 'green' : this.tom}`;
  }

  /** Sparkline herda a cor do tom do tile. */
  tracoClasse(): string {
    const mapa: Record<string, string> = {
      green: 'text-forest-300',
      beige: 'text-beige-300',
      purple: 'text-lilac-300',
      tosca: 'text-tosca-300',
      dark: 'text-ink',
    };
    return mapa[this.tom] ?? 'text-forest-300';
  }

  deltaAbs(): number {
    return Math.abs(this.delta ?? 0);
  }

  readonly paths = computed(() => {
    const valores = this.pontos();
    if (!valores || valores.length < 2) return { line: '', area: '' };
    const width = 72;
    const height = 28;
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
