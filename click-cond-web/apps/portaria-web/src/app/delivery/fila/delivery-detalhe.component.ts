import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryStatus } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { organizarAcoes, verboAcao } from '../shared/delivery-status';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { DeliveryTimelineComponent } from '../shared/delivery-timeline.component';

@Component({
  selector: 'app-delivery-detalhe',
  standalone: true,
  imports: [FormsModule, DeliveryStatusBadgeComponent, DeliveryTimelineComponent],
  templateUrl: './delivery-detalhe.component.html',
})
export class DeliveryDetalheComponent {
  readonly store = inject(DeliveryStore);
  readonly confirmandoRecusa = signal(false);
  readonly verbo = verboAcao;
  readonly acoes = computed(() => {
    const a = this.store.selecionado();
    return a ? organizarAcoes(this.store.proximosStatus(a)) : null;
  });

  desabilitada(status: DeliveryStatus): boolean {
    const a = this.store.selecionado();
    return this.store.carregando() || (status === 'AUTORIZADA' && !!a && !this.store.podeAutorizar(a));
  }

  executar(status: DeliveryStatus): void {
    this.store.atualizarStatus(status);
  }

  confirmarRecusa(): void {
    this.store.atualizarStatus('RECUSADA');
    if (!this.store.erro()) this.confirmandoRecusa.set(false);
  }

  fechar(): void {
    this.confirmandoRecusa.set(false);
    this.store.selecionado.set(null);
  }
}
