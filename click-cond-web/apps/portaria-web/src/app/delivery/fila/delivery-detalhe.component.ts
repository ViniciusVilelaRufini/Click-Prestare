import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryStatus } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { organizarAcoes, verboAcao } from '../shared/delivery-status';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { DeliveryTimelineComponent } from '../shared/delivery-timeline.component';

@Component({
  selector: 'app-delivery-detalhe',
  standalone: true,
  host: { class: 'block' },
  imports: [FormsModule, DeliveryStatusBadgeComponent, DeliveryTimelineComponent],
  templateUrl: './delivery-detalhe.component.html',
})
export class DeliveryDetalheComponent {
  readonly store = inject(DeliveryStore);
  private readonly recusaAberta = signal(false);
  private readonly idSelecionado = computed(() => this.store.selecionado()?.id);
  readonly verbo = verboAcao;
  readonly acoes = computed(() => {
    const a = this.store.selecionado();
    return a ? organizarAcoes(this.store.proximosStatus(a)) : null;
  });
  /** Formulário de recusa: só aparece enquanto o atendimento aberto ainda aceita RECUSADA. */
  readonly confirmandoRecusa = computed(() => this.recusaAberta() && !!this.acoes()?.recusar);

  constructor() {
    // Trocar de atendimento sempre fecha o formulário (o motivo digitado pertence ao anterior).
    effect(() => {
      this.idSelecionado();
      untracked(() => this.recusaAberta.set(false));
    });
  }

  desabilitada(status: DeliveryStatus): boolean {
    const a = this.store.selecionado();
    return this.store.carregando() || (status === 'AUTORIZADA' && !!a && !this.store.podeAutorizar(a));
  }

  executar(status: DeliveryStatus): void {
    this.store.atualizarStatus(status);
  }

  abrirRecusa(): void {
    this.recusaAberta.set(true);
  }

  fecharRecusa(): void {
    this.recusaAberta.set(false);
  }

  /** Não fecha o formulário: ele some sozinho quando o atendimento sai da fila ou perde a ação. */
  confirmarRecusa(): void {
    this.store.atualizarStatus('RECUSADA');
  }

  fechar(): void {
    this.fecharRecusa();
    this.store.selecionado.set(null);
  }
}
