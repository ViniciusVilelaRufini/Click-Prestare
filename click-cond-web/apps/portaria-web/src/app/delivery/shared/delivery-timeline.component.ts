import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DeliveryEvento } from '../delivery.model';
import { classesStatus, rotuloStatus } from './delivery-status';

@Component({
  selector: 'app-delivery-timeline',
  standalone: true,
  host: { class: 'block' },
  imports: [DatePipe],
  template: `
    @if (eventos().length) {
      <ol class="relative ml-1.5 space-y-4 border-l border-white/10 pl-5">
        @for (evento of eventos(); track evento.id ?? $index) {
          <li class="relative">
            <span [class]="'absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-[color:var(--bg-surface)] ' + cls(evento).ponto"></span>
            <p class="text-sm font-medium text-white">{{ rotulo(evento) }}</p>
            <p class="text-xs text-slate-400">{{ evento.autor_nome || 'Sistema' }} · {{ evento.created_at | date: 'dd/MM HH:mm' }}</p>
            @if (evento.mensagem) {
              <p class="mt-1 text-sm text-slate-300">{{ evento.mensagem }}</p>
            }
          </li>
        }
      </ol>
    } @else {
      <p class="text-sm text-slate-400">Sem eventos registrados.</p>
    }
  `,
})
export class DeliveryTimelineComponent {
  readonly eventos = input.required<DeliveryEvento[]>();
  rotulo = (e: DeliveryEvento) => rotuloStatus(e.status_novo);
  cls = (e: DeliveryEvento) => classesStatus(e.status_novo);
}
