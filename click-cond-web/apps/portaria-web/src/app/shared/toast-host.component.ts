import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed bottom-6 right-6 z-[10000] flex flex-col gap-3 w-[calc(100%-3rem)] max-w-md pointer-events-none items-end">
      @for (t of svc.toasts(); track t.id) {
        <div class="ps-toast on !static !max-w-full pointer-events-auto animate-slide-in" role="alert">
          <span class="ps-dot shrink-0 outline outline-1 outline-offset-0"
                style="outline-color: var(--on-accent)"
                [class.ps-dot-ok]="t.type === 'success'"
                [class.ps-dot-danger]="t.type === 'error'"
                [class.ps-dot-warn]="t.type === 'warning'"
                [class.ps-dot-ink]="t.type === 'info'"></span>
          <p class="flex-1 min-w-0 text-sm">{{ t.message }}</p>
          <button type="button" (click)="svc.remove(t.id)" aria-label="Fechar"
                  class="ps-ibtn !w-6 !h-6 !text-[var(--on-accent)] hover:!bg-transparent opacity-70 hover:opacity-100 shrink-0">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(16px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .animate-slide-in {
      animation: slideIn 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    }
  `]
})
export class ToastHostComponent {
  readonly svc = inject(ToastService);
}
