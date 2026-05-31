import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from './confirm.service';

@Component({
  selector: 'app-confirm-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (svc.state(); as s) {
      <div class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 animate-fade-in"
           (click)="svc.resolve(false)">
        <div class="w-full max-w-md rounded-2xl bg-graphite border border-white/10 shadow-2xl overflow-hidden"
             (click)="$event.stopPropagation()">
          <div class="px-6 pt-6 pb-4">
            <div class="flex items-start gap-3">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                   [class.bg-red-400\/10]="s.variant === 'danger'"
                   [class.border-red-400\/25]="s.variant === 'danger'"
                   [class.text-red-400]="s.variant === 'danger'"
                   [class.bg-accent\/10]="s.variant === 'primary'"
                   [class.border-accent\/25]="s.variant === 'primary'"
                   [class.text-accent]="s.variant === 'primary'"
                   class="border">
                @if (s.variant === 'danger') {
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  </svg>
                } @else {
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                }
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-base font-semibold text-white">{{ s.title }}</h3>
                <p class="text-sm text-slate-400 mt-1 whitespace-pre-line">{{ s.message }}</p>
              </div>
            </div>
          </div>
          <div class="px-6 py-4 bg-white/[0.02] border-t border-white/10 flex items-center justify-end gap-2">
            <button type="button" (click)="svc.resolve(false)"
                    class="px-4 py-2 text-sm rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition">
              {{ s.cancelLabel }}
            </button>
            <button type="button" (click)="svc.resolve(true)"
                    class="px-5 py-2 text-sm rounded-lg font-medium text-white transition"
                    [class.bg-red-500]="s.variant === 'danger'"
                    [class.hover:bg-red-600]="s.variant === 'danger'"
                    [class.bg-accent]="s.variant === 'primary'"
                    [class.hover:bg-accent-600]="s.variant === 'primary'">
              {{ s.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmHostComponent {
  readonly svc = inject(ConfirmService);

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.svc.state()) this.svc.resolve(false);
  }
}
