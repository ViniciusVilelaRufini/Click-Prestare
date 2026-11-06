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
  readonly campo = 'w-full h-10 px-3 text-sm bg-graphite-50 border border-slate-300 text-white placeholder-slate-500 focus:outline-none focus:border-[var(--ink)]';

  ngOnInit(): void {
    if (!this.store.entregadores().length) this.store.carregarEntregadores();
    this.destroyRef.onDestroy(() => this.store.limparBuscaEntregadores());
  }
}
