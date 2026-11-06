import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-pill',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ps-kpi border border-[var(--line-100)] min-w-[140px]">
      @if (icon) {
        <div class="ps-kpi-row1">
          <span class="[&_svg]:w-[17px] [&_svg]:h-[17px]" [innerHTML]="icon"></span>
        </div>
      }
      <div class="flex flex-col gap-1.5">
        <span class="ps-num">{{ valorExibido }}</span>
        <span class="ps-cap">{{ label }}</span>
      </div>
    </div>
  `,
})
export class StatPillComponent {
  @Input() label = '';
  @Input() value: string | number = 0;
  @Input() icon = '';
  /** Aceitos por compatibilidade; o ícone é sempre monocromático e sem fundo. */
  @Input() iconColor = '';
  @Input() iconBg = '';

  /** Zero à esquerda só na apresentação (5 vira 05); o valor recebido não muda. */
  get valorExibido(): string {
    const v = this.value;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10) return `0${v}`;
    if (typeof v === 'string' && /^[0-9]$/.test(v)) return `0${v}`;
    return String(v);
  }
}
