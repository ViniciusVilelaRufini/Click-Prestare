import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { DeliveryStore, AbaDelivery } from './delivery.store';
import { DeliveryFilaComponent } from './fila/delivery-fila.component';
import { DeliveryEntregadoresComponent } from './entregadores/delivery-entregadores.component';
import { DeliveryHistoricoComponent } from './historico/delivery-historico.component';

const INTERVALO_ATUALIZACAO_MS = 20_000;

@Component({
  selector: 'app-delivery-page',
  standalone: true,
  imports: [DeliveryFilaComponent, DeliveryEntregadoresComponent, DeliveryHistoricoComponent],
  providers: [DeliveryStore],
  templateUrl: './delivery-page.component.html',
})
export class DeliveryPageComponent implements OnInit {
  readonly store = inject(DeliveryStore);
  private readonly destroyRef = inject(DestroyRef);

  abas(): { id: AbaDelivery; rotulo: string }[] {
    const lista: { id: AbaDelivery; rotulo: string }[] = [
      { id: 'fila', rotulo: 'Fila' },
      { id: 'entregadores', rotulo: 'Entregadores' },
    ];
    if (this.store.podeGerenciarEntregadores()) lista.push({ id: 'historico', rotulo: 'Histórico e relatório' });
    return lista;
  }

  ngOnInit(): void {
    this.store.carregarFila();
    this.store.carregarEntregadores();
    const timer = setInterval(() => {
      if (this.store.aba() !== 'fila') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      this.store.carregarFila({ silencioso: true });
    }, INTERVALO_ATUALIZACAO_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }
}
