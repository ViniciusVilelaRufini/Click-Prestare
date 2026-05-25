import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DashboardApi, DashboardSummary } from './dashboard.service';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-page.component.html',
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  private api = inject(DashboardApi);
  readonly auth = inject(AuthService);

  readonly data = signal<DashboardSummary | null>(null);
  readonly loading = signal(true);
  readonly agora = signal(new Date());
  readonly eventoSelecionado = signal<any | null>(null);
  readonly filtroEvento = signal<string>('Todos');

  readonly eventosFiltrados = computed(() => {
    const summary = this.data();
    if (!summary) return [];
    const filtro = this.filtroEvento();
    if (filtro === 'Todos') {
      return summary.ultimosEventos;
    }
    return summary.ultimosEventos.filter(e => e.tipo === filtro);
  });

  private clockInterval?: ReturnType<typeof setInterval>;
  private refreshInterval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.load();
    this.clockInterval = setInterval(() => this.agora.set(new Date()), 1000);
    this.refreshInterval = setInterval(() => this.load(), 60_000);
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
  }

  private load() {
    this.api.get().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  tipoColor(tipo: string): string {
    return tipo === 'Visitante' ? 'text-accent bg-accent/10 border-accent/20'
      : tipo === 'Encomenda'   ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
      : 'text-amber-400 bg-amber-400/10 border-amber-400/20';
  }

  abrirDetalhes(evento: any) {
    this.eventoSelecionado.set(evento);
  }

  fecharDetalhes() {
    this.eventoSelecionado.set(null);
  }

  formatarDataEvento(quandoStr: string): string {
    const data = new Date(quandoStr);
    const hoje = new Date();
    
    const isHoje = data.getDate() === hoje.getDate() &&
                   data.getMonth() === hoje.getMonth() &&
                   data.getFullYear() === hoje.getFullYear();
                   
    const ontem = new Date();
    ontem.setDate(hoje.getDate() - 1);
    const isOntem = data.getDate() === ontem.getDate() &&
                    data.getMonth() === ontem.getMonth() &&
                    data.getFullYear() === ontem.getFullYear();

    const horas = String(data.getHours()).padStart(2, '0');
    const minutos = String(data.getMinutes()).padStart(2, '0');
    const horaStr = `${horas}:${minutos}`;

    if (isHoje) {
      return `Hoje, ${horaStr}`;
    } else if (isOntem) {
      return `Ontem, ${horaStr}`;
    } else {
      const dia = String(data.getDate()).padStart(2, '0');
      const mes = String(data.getMonth() + 1).padStart(2, '0');
      const ano = data.getFullYear();
      return `${dia}/${mes}/${ano} às ${horaStr}`;
    }
  }
}
