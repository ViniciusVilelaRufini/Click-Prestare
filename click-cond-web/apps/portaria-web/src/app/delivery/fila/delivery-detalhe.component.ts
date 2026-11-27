import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeliveryAtendimento, DeliveryStatus } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { ehTerminal, organizarAcoes, rotuloStatus, verboAcao } from '../shared/delivery-status';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { RELACOES_RETIRADA } from '../shared/relacao-retirada';
import { DeliveryTimelineComponent } from '../shared/delivery-timeline.component';

type ComMotivo = 'RECUSADA' | 'CANCELADA';

@Component({
  selector: 'app-delivery-detalhe',
  standalone: true,
  host: { class: 'block' },
  imports: [DatePipe, FormsModule, DeliveryStatusBadgeComponent, DeliveryTimelineComponent],
  templateUrl: './delivery-detalhe.component.html',
})
export class DeliveryDetalheComponent {
  readonly store = inject(DeliveryStore);
  /** Recusa ou cancelamento com o formulário de motivo aberto. */
  private readonly motivoPara = signal<ComMotivo | null>(null);
  private readonly idSelecionado = computed(() => this.store.selecionado()?.id);
  readonly verbo = verboAcao;
  readonly relacoes = RELACOES_RETIRADA;
  /** Dica do "Autorizar subida" desabilitado (só quando essa ação está entre as próximas). */
  readonly dicaAutorizar = computed(() => {
    const a = this.store.selecionado();
    return a && this.store.proximosStatus(a).includes('AUTORIZADA') ? this.store.dicaAutorizar(a) : null;
  });
  readonly dicaPedir = computed(() => {
    const a = this.store.selecionado();
    return a && this.store.proximosStatus(a).includes('AGUARDANDO_AUTORIZACAO') ? this.store.dicaPedirAutorizacao(a) : null;
  });
  readonly acoes = computed(() => {
    const a = this.store.selecionado();
    return a ? organizarAcoes(this.store.proximosStatus(a), a.modo_entrega) : null;
  });
  /** Formulário de motivo: só aparece enquanto o atendimento aberto ainda aceita a ação. */
  readonly confirmandoMotivo = computed<ComMotivo | null>(() => {
    const alvo = this.motivoPara();
    const acoes = this.acoes();
    if (alvo === 'RECUSADA' && acoes?.recusar) return alvo;
    if (alvo === 'CANCELADA' && acoes?.cancelar) return alvo;
    return null;
  });
  /**
   * Entregador que veio pelo QR do portão e "Autorizar" entre as ações: a
   * autorização da portaria não abre o portão pela nuvem (o porteiro abre
   * pelo meio de sempre).
   */
  readonly avisoPortao = computed(() => {
    const a = this.store.selecionado();
    const acoes = this.acoes();
    if (!a || !acoes || !this.store.veioDoPortao(a)) return false;
    return acoes.primaria === 'AUTORIZADA' || acoes.secundarias.includes('AUTORIZADA');
  });
  /** Encerrado (recusado, cancelado, concluído) ou fora da fila: o painel mostra o desfecho. */
  readonly encerrado = computed(() => {
    const a = this.store.selecionado();
    return !!a && (ehTerminal(a.status) || this.store.selecionadoSaiu());
  });

  constructor() {
    // Trocar de atendimento sempre fecha o formulário (o motivo digitado pertence ao anterior).
    effect(() => {
      this.idSelecionado();
      untracked(() => this.motivoPara.set(null));
    });
  }

  desabilitada(status: DeliveryStatus): boolean {
    const a = this.store.selecionado();
    return this.store.carregando()
      || (status === 'AUTORIZADA' && !!a && !this.store.podeAutorizar(a))
      || (status === 'AGUARDANDO_AUTORIZACAO' && !!a && !this.store.podePedirAutorizacao(a));
  }

  executar(status: DeliveryStatus): void {
    this.store.atualizarStatus(status);
  }

  abrirRecusa(): void {
    this.motivoPara.set('RECUSADA');
  }

  abrirCancelamento(): void {
    this.motivoPara.set('CANCELADA');
  }

  fecharRecusa(): void {
    this.motivoPara.set(null);
  }

  /** Não fecha o formulário: ele some sozinho quando o atendimento sai da fila ou perde a ação. */
  confirmarMotivo(): void {
    const alvo = this.confirmandoMotivo();
    if (alvo) this.store.atualizarStatus(alvo);
  }

  /** "Recusada por Maria", "Cancelada por Portaria": quem levou ao status atual, pela linha do tempo. */
  desfecho(a: DeliveryAtendimento): string {
    const evento = [...(a.eventos ?? [])].reverse().find((e) => e.status_novo === a.status);
    const autor = evento?.autor_nome?.trim();
    return autor ? `${rotuloStatus(a.status)} por ${autor}` : rotuloStatus(a.status);
  }

  fechar(): void {
    this.fecharRecusa();
    this.store.fecharPainel();
  }
}
