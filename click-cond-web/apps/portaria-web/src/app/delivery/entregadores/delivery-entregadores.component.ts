import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryStore } from '../delivery.store';

@Component({
  selector: 'app-delivery-entregadores',
  standalone: true,
  host: { class: 'block' },
  imports: [FormsModule],
  templateUrl: './delivery-entregadores.component.html',
})
export class DeliveryEntregadoresComponent implements OnInit {
  readonly store = inject(DeliveryStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly campo = 'w-full rounded-lg border border-white/10 bg-graphite px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:border-accent/60 focus:outline-none';

  ngOnInit(): void {
    if (!this.store.entregadores().length) this.store.carregarEntregadores();
    this.destroyRef.onDestroy(() => this.store.limparBuscaEntregadores());
  }
}
