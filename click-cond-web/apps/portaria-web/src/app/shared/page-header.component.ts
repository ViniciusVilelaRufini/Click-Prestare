import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ps-phead mb-6">
      <div class="ps-phead-t">
        <h1 class="ps-h1">{{ title }}</h1>
        @if (subtitle) {
          <p class="text-sm">{{ subtitle }}</p>
        }
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() subtitle = '';
  /** Aceito por compatibilidade; o cabeçalho do tema Prestare Dark não desenha ícone. */
  @Input() icon = '';
}
