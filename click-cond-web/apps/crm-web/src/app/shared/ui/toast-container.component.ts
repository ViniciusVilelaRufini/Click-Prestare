import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../toast.service';

/**
 * Container fixo de toasts (canto inferior direito), alimentado pelo
 * ToastService. Ícone por tipo + botão de dispensar. aria-live para leitores.
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="pointer-events-auto flex items-start gap-3 rounded-2xl bg-surface-raised p-3 shadow-pop animate-toast-in">
          <span
            class="tile h-9 w-9 shrink-0 rounded-xl"
            [ngClass]="{
              'tile-green': t.tipo === 'success',
              'tile-red': t.tipo === 'error',
              'tile-tosca': t.tipo === 'info'
            }"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              @if (t.tipo === 'success') {
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              } @else if (t.tipo === 'error') {
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              } @else {
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              }
            </svg>
          </span>
          <p class="flex-1 pt-1.5 text-sm leading-snug text-ink">{{ t.message }}</p>
          <button
            type="button"
            class="press -m-1 rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label="Dispensar notificação"
            (click)="toast.dismiss(t.id)"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastContainerComponent {
  readonly toast = inject(ToastService);
}
