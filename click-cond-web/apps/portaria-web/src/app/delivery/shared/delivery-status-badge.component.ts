import { Component, computed, input } from '@angular/core';
import { DeliveryStatus } from '../delivery.model';
import { classesStatus, rotuloStatus } from './delivery-status';

@Component({
  selector: 'app-delivery-status-badge',
  standalone: true,
  template: `<span [class]="'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ' + cls().fundo + ' ' + cls().borda + ' ' + cls().texto"><span [class]="'h-1.5 w-1.5 rounded-full ' + cls().ponto"></span>{{ rotulo() }}</span>`,
})
export class DeliveryStatusBadgeComponent {
  readonly status = input.required<DeliveryStatus>();
  readonly rotulo = computed(() => rotuloStatus(this.status()));
  readonly cls = computed(() => classesStatus(this.status()));
}
