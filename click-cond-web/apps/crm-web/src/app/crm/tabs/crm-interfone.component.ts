import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ClienteInterfone, InterfoneCrmApi } from '../interfone.service';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

/**
 * Aba Interfone: libera o módulo "Interfone pelo app" condomínio a condomínio quando a venda fecha. Contratar só
 * mostra a aba no console do síndico — quem liga as chamadas é o síndico, lá. Cobrança fica fora.
 */
@Component({
  selector: 'crm-interfone',
  standalone: true,
  imports: [EmptyStateComponent],
  templateUrl: './crm-interfone.component.html',
})
export class CrmInterfoneComponent implements OnInit {
  private readonly api = inject(InterfoneCrmApi);
  private readonly toast = inject(ToastService);

  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);
  readonly clientes = signal<ClienteInterfone[]>([]);
  readonly alterando = signal<number | null>(null);
  readonly totalContratados = computed(() => this.clientes().filter((c) => c.contratado).length);

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api.clientes().subscribe({
      next: (lista) => {
        this.clientes.set(Array.isArray(lista) ? lista.map((c) => ({ ...c, contratado: !!c.contratado })) : []);
        this.carregando.set(false);
      },
      error: (e) => {
        this.erro.set(e?.error?.message ?? 'Não foi possível carregar os condomínios.');
        this.carregando.set(false);
      },
    });
  }

  /** Contratar pede confirmação; descontratar vai direto. A caixa volta ao estado real se cancelar ou falhar. */
  alternar(c: ClienteInterfone, caixa: HTMLInputElement): void {
    const ligado = caixa.checked;
    if (ligado) {
      const ok = confirm(
        `Liberar o Interfone pelo app para "${c.nome}"?\n\n` +
          'O síndico passa a ver a aba Interfone no console e decide lá quando ligar as chamadas.',
      );
      if (!ok) {
        caixa.checked = c.contratado;
        return;
      }
    }
    this.alterando.set(c.id);
    this.api.definirContratado(c.id, ligado).subscribe({
      next: (r) => {
        const contratado = typeof r?.contratado === 'boolean' ? r.contratado : ligado;
        this.clientes.update((l) => l.map((x) => (x.id === c.id ? { ...x, contratado } : x)));
        caixa.checked = contratado;
        this.alterando.set(null);
        this.toast.trigger(
          contratado ? `Interfone de "${c.nome}" contratado.` : `Interfone de "${c.nome}" desligado.`,
          contratado ? 'success' : 'info',
        );
      },
      error: (e) => {
        caixa.checked = c.contratado;
        this.alterando.set(null);
        this.toast.trigger(e?.error?.message ?? 'Não foi possível alterar.', 'error');
      },
    });
  }
}
