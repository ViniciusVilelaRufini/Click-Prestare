import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryAtendimento, DeliveryStatus } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { STATUS_CARDS, STATUS_FILTRO, classesStatus, rotuloStatus } from '../shared/delivery-status';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { emAtencao, inicioEspera, minutosDesde, textoEspera } from '../shared/tempo';
import { DeliveryDetalheComponent } from './delivery-detalhe.component';

@Component({
  selector: 'app-delivery-fila',
  standalone: true,
  host: { class: 'block' },
  imports: [FormsModule, DeliveryStatusBadgeComponent, DeliveryDetalheComponent],
  templateUrl: './delivery-fila.component.html',
})
export class DeliveryFilaComponent {
  readonly store = inject(DeliveryStore);
  readonly cards = STATUS_CARDS;
  readonly opcoesFiltro = STATUS_FILTRO;
  readonly rotulo = rotuloStatus;
  readonly cls = classesStatus;

  espera(a: DeliveryAtendimento): string {
    return textoEspera(minutosDesde(inicioEspera(a), this.store.agora()));
  }

  atencao(a: DeliveryAtendimento): boolean {
    return emAtencao(a, this.store.agora());
  }

  modo(a: DeliveryAtendimento): string {
    return a.modo_entrega === 'PORTARIA' ? 'Na portaria' : 'Na unidade';
  }

  filtroAtivo(status: DeliveryStatus): boolean {
    return this.store.filtroStatus() === status;
  }
}
