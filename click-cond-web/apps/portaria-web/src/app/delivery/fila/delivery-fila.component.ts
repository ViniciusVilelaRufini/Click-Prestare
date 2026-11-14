import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DeliveryAtendimento, DeliveryStatus } from '../delivery.model';
import { DeliveryStore } from '../delivery.store';
import { STATUS_CARDS, STATUS_FILTRO, classesStatus, ehTerminal, rotuloStatus } from '../shared/delivery-status';
import { DeliveryStatusBadgeComponent } from '../shared/delivery-status-badge.component';
import { emAtencao, inicioEspera, minutosDesde, textoEspera } from '../shared/tempo';
import { DeliveryDetalheComponent } from './delivery-detalhe.component';

@Component({
  selector: 'app-delivery-fila',
  standalone: true,
  host: { class: 'block' },
  imports: [DatePipe, FormsModule, DeliveryStatusBadgeComponent, DeliveryDetalheComponent],
  templateUrl: './delivery-fila.component.html',
})
export class DeliveryFilaComponent {
  readonly store = inject(DeliveryStore);
  readonly cards = STATUS_CARDS;
  readonly opcoesFiltro = STATUS_FILTRO;
  readonly rotulo = rotuloStatus;
  readonly cls = classesStatus;
  readonly terminal = (a: DeliveryAtendimento) => ehTerminal(a.status);
  /** Contagem do cabeçalho: só o que ainda pede ação (recusados/cancelados recentes ficam de fora). */
  readonly pendentes = computed(() => this.store.fila().filter((a) => !ehTerminal(a.status)).length);

  /** Tempo da etapa atual, com o que ela significa quando não é a espera na portaria. */
  espera(a: DeliveryAtendimento): string {
    const texto = textoEspera(minutosDesde(inicioEspera(a), this.store.agora()));
    if (a.status === 'AUTORIZADA') return `Subiu ${texto}`;
    if (a.status === 'RETIRADA_NA_PORTARIA') return `Na portaria ${texto}`;
    if (a.status === 'RECUSADA') return `Recusada ${texto}`;
    if (a.status === 'CANCELADA') return `Cancelada ${texto}`;
    return texto;
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

  /** Previsão de hoje só com a hora; de outro dia com a data (aviso de amanhã parecia de hoje). */
  formatoPrevisao(iso: string): string {
    const p = new Date(iso);
    const hoje = this.store.agora();
    const mesmoDia = p.getFullYear() === hoje.getFullYear() && p.getMonth() === hoje.getMonth() && p.getDate() === hoje.getDate();
    return mesmoDia ? 'HH:mm' : 'dd/MM HH:mm';
  }
}
