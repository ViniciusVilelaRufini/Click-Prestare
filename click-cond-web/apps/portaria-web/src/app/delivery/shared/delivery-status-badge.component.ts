import { Component, computed, input } from '@angular/core';
import { DeliveryStatus } from '../delivery.model';
import { classesStatus, rotuloStatus } from './delivery-status';

@Component({
  selector: 'app-delivery-status-badge',
  standalone: true,
  template: `<span [class]="'ps-tag whitespace-nowrap ' + cls().texto"><span [class]="'ps-dot ' + cls().ponto"></span>{{ rotulo() }}</span>`,
})
export class DeliveryStatusBadgeComponent {
  readonly status = input.required<DeliveryStatus>();
  readonly rotulo = computed(() => rotuloStatus(this.status()));
  readonly cls = computed(() => classesStatus(this.status()));
}
