import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subscription, forkJoin } from 'rxjs';
import { DeliveryApi } from '../delivery.service';
import { DeliveryAtendimento, DeliveryResumo } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { DeliveryTimelineComponent } from '../shared/delivery-timeline.component';
import { PeriodoHistorico, intervaloPeriodo, textoDuracao } from '../shared/tempo';

@Component({
  selector: 'app-delivery-historico',
  standalone: true,
  imports: [DatePipe, FormsModule, DeliveryStatusBadgeComponent, DeliveryTimelineComponent],
  templateUrl: './delivery-historico.component.html',
})
export class DeliveryHistoricoComponent implements OnInit {
  private readonly api = inject(DeliveryApi);
  readonly store = inject(DeliveryStore);
  private readonly destroyRef = inject(DestroyRef);
  private requisicao?: Subscription;

  readonly periodos: { valor: PeriodoHistorico; rotulo: string }[] = [
    { valor: 'hoje', rotulo: 'Hoje' },
    { valor: '7d', rotulo: '7 dias' },
    { valor: '30d', rotulo: '30 dias' },
  ];
  readonly periodo = signal<PeriodoHistorico>('7d');
  readonly lista = signal<DeliveryAtendimento[]>([]);
  readonly resumo = signal<DeliveryResumo | null>(null);
  readonly busca = signal('');
  readonly selecionado = signal<DeliveryAtendimento | null>(null);
  readonly carregando = signal(false);
  readonly duracao = textoDuracao;
  readonly placeholder = computed(() => (this.carregando() ? '…' : '—'));

  readonly filtrados = computed(() => {
    const busca = this.store.buscaNormalizada(this.busca());
    return this.lista().filter((a) => this.store.correspondeBusca(a, busca));
  });

  ngOnInit(): void {
    this.carregar();
  }

  mudarPeriodo(p: PeriodoHistorico): void {
    this.periodo.set(p);
    this.selecionado.set(null);
    this.lista.set([]);
    this.resumo.set(null);
    this.carregar();
  }

  carregar(): void {
    this.requisicao?.unsubscribe();
    const { de, ate } = intervaloPeriodo(this.periodo(), new Date());
    this.carregando.set(true);
    this.requisicao = forkJoin({
      lista: this.api.listHistorico(de, ate),
      resumo: this.api.resumo(de, ate),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ lista, resumo }) => {
        this.lista.set(lista);
        this.resumo.set(resumo);
        this.carregando.set(false);
      },
      error: (error) => {
        this.lista.set([]);
        this.resumo.set(null);
        this.carregando.set(false);
        this.store.definirErro(error, 'Não foi possível carregar o histórico.');
      },
    });
  }
}
