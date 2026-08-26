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
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="card p-5">
              <div class="flex items-center gap-3">
                <div class="shimmer h-11 w-11 shrink-0 rounded-xl"></div>
                <div class="shimmer h-3 w-24 rounded-full"></div>
              </div>
              <div class="shimmer mt-4 h-8 w-32 rounded-lg"></div>
              <div class="shimmer mt-3 h-2.5 w-20 rounded-full"></div>
            </div>
          }
        </div>
      }
      @case ('tabela') {
        <div class="card p-3" aria-hidden="true">
          <div class="rounded-xl bg-surface-sunken px-4 py-3.5">
            <div class="shimmer h-3 w-48 rounded-full"></div>
          </div>
          @for (i of linhas; track i) {
            <div class="flex items-center gap-4 px-4 py-4">
              <div class="shimmer h-11 w-11 shrink-0 rounded-xl"></div>
              <div class="flex-1 space-y-2">
                <div class="shimmer h-3 w-1/3 rounded-full"></div>
                <div class="shimmer h-2.5 w-1/5 rounded-full"></div>
              </div>
              <div class="shimmer h-3 w-16 rounded-full"></div>
              <div class="shimmer hidden h-6 w-20 rounded-full sm:block"></div>
            </div>
          }
        </div>
      }
      @default {
        <div class="card p-6" aria-hidden="true">
          <div class="shimmer h-4 w-1/3 rounded-full"></div>
          <div class="shimmer mt-4 h-3 w-2/3 rounded-full"></div>
          <div class="shimmer mt-2.5 h-3 w-1/2 rounded-full"></div>
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
