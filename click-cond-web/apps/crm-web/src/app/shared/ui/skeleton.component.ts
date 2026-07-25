import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Skeleton de carregamento padronizado com shimmer.
 * Variantes: 'kpi' (grade de 4 blocos), 'tabela' (header + N linhas), 'card' (bloco único).
 * Uso: <app-skeleton variante="tabela" [rows]="6" />
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    @switch (variante) {
      @case ('kpi') {
        <div class="grid grid-cols-2 gap-5 lg:grid-cols-4" aria-hidden="true">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="card p-5">
              <div class="shimmer h-3 w-20 rounded"></div>
              <div class="shimmer mt-3 h-7 w-28 rounded"></div>
              <div class="shimmer mt-3 h-2 w-16 rounded"></div>
            </div>
          }
        </div>
      }
      @case ('tabela') {
        <div class="card overflow-hidden" aria-hidden="true">
          <div class="border-b border-line bg-surface-sunken px-5 py-3">
            <div class="shimmer h-3 w-48 rounded"></div>
          </div>
          @for (i of linhas; track i) {
            <div class="flex items-center gap-4 border-b border-line-subtle px-5 py-4 last:border-b-0">
              <div class="shimmer h-8 w-8 shrink-0 rounded-full"></div>
              <div class="flex-1 space-y-2">
                <div class="shimmer h-3 w-1/3 rounded"></div>
                <div class="shimmer h-2 w-1/5 rounded"></div>
              </div>
              <div class="shimmer h-3 w-16 rounded"></div>
              <div class="shimmer hidden h-3 w-12 rounded sm:block"></div>
            </div>
          }
        </div>
      }
      @default {
        <div class="card p-5" aria-hidden="true">
          <div class="shimmer h-4 w-1/3 rounded"></div>
          <div class="shimmer mt-3 h-3 w-2/3 rounded"></div>
          <div class="shimmer mt-2 h-3 w-1/2 rounded"></div>
        </div>
      }
    }
  `,
})
export class SkeletonComponent {
  @Input() variante: 'kpi' | 'tabela' | 'card' = 'card';
  @Input() set rows(n: number) {
    this.linhas = Array.from({ length: Math.max(1, n) }, (_, i) => i);
  }
  linhas = [0, 1, 2, 3, 4];
}
