import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmService } from './confirm.service';

@Component({
  selector: 'app-confirm-host',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (svc.state(); as s) {
      <div class="ps-scrim on !z-[9998]" (click)="svc.resolve(false)"></div>
      <div class="ps-modal on !z-[9999]" role="dialog" aria-modal="true">
        <div class="flex flex-col gap-2.5">
          <div class="flex items-center gap-2.5">
            @if (s.variant === 'danger') {
              <span class="ps-dot ps-dot-danger"></span>
            }
            <h3 class="ps-h2">{{ s.title }}</h3>
          </div>
          <p class="text-sm leading-relaxed whitespace-pre-line" style="color: var(--ink-muted)">{{ s.message }}</p>
        </div>
        <div class="flex items-center justify-end gap-2.5">
          <button type="button" (click)="svc.resolve(false)" class="ps-btn ps-btn-sec">
            {{ s.cancelLabel }}
          </button>
          <button type="button" (click)="svc.resolve(true)"
                  class="ps-btn"
                  [class.ps-btn-danger]="s.variant === 'danger'">
            {{ s.confirmLabel }}
          </button>
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
