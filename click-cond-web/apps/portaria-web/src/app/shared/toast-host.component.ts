import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="fixed top-6 right-6 z-[10000] flex flex-col gap-3 w-full max-w-md pointer-events-none">
      @for (t of svc.toasts(); track t.id) {
        <div class="pointer-events-auto flex items-start gap-3 p-4 rounded-xl border bg-slate-900/95 backdrop-blur-md border-white/10 shadow-2xl animate-slide-in"
             [class.border-emerald-500\/30]="t.type === 'success'"
             [class.border-rose-500\/30]="t.type === 'error'"
             [class.border-amber-500\/30]="t.type === 'warning'"
             [class.border-blue-500\/30]="t.type === 'info'"
             role="alert">
          
          <!-- Icon -->
          <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border"
               [class.bg-emerald-500\/10]="t.type === 'success'"
               [class.border-emerald-500\/25]="t.type === 'success'"
               [class.text-emerald-400]="t.type === 'success'"
               
               [class.bg-rose-500\/10]="t.type === 'error'"
               [class.border-rose-500\/25]="t.type === 'error'"
               [class.text-rose-400]="t.type === 'error'"
               
               [class.bg-amber-500\/10]="t.type === 'warning'"
               [class.border-amber-500\/25]="t.type === 'warning'"
               [class.text-amber-400]="t.type === 'warning'"
               
               [class.bg-blue-500\/10]="t.type === 'info'"
               [class.border-blue-500\/25]="t.type === 'info'"
               [class.text-blue-400]="t.type === 'info'">
            
            @switch (t.type) {
              @case ('success') {
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                </svg>
              }
              @case ('error') {
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                </svg>
              }
              @case ('warning') {
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              }
              @case ('info') {
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            }
          </div>

          <!-- Message -->
          <div class="flex-1 min-w-0 pt-0.5">
            <p class="text-sm font-medium toast-text-white">{{ t.message }}</p>
          </div>

          <!-- Close Button -->
          <button type="button" 
                  (click)="svc.remove(t.id)"
                  class="toast-close-btn rounded-lg p-1 transition pointer-events-auto">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
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
        transform: translateX(100%) scale(0.9);
      }
      to {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }
    .animate-slide-in {
      animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    /* Garantir contraste do Toast em Light/Dark mode */
    .toast-text-white {
      color: #ffffff !important;
    }
    .toast-close-btn {
      color: #94a3b8 !important;
    }
    .toast-close-btn:hover {
      color: #ffffff !important;
      background-color: rgba(255, 255, 255, 0.1) !important;
    }
  `]
})
export class ToastHostComponent {
  readonly svc = inject(ToastService);
}
