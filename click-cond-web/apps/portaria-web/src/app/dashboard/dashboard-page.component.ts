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
  host: {
    '(window:keydown.escape)': 'onEscapePressed()'
  }
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  private api = inject(DashboardApi);
  readonly auth = inject(AuthService);

  readonly data = signal<DashboardSummary | null>(null);
  readonly loading = signal(true);
  readonly agora = signal(new Date());
  readonly eventoSelecionado = signal<any | null>(null);
  readonly filtroEvento = signal<string>('Todos');
  readonly eventosMaximizados = signal(false);
  readonly buscaTexto = signal('');
  readonly filtroDirecao = signal<'todos' | 'entrada' | 'saida'>('todos');
  readonly modoCompacto = signal(false);

  readonly eventosFiltrados = computed(() => {
    const summary = this.data();
    if (!summary) return [];
    
    let filtrados = summary.ultimosEventos;
    const filtro = this.filtroEvento();
    const busca = this.buscaTexto().toLowerCase().trim();
    const direcao = this.filtroDirecao();

    // 1. Filtro por tipo de evento
    if (filtro !== 'Todos') {
      if (filtro === 'Visitante') {
        filtrados = filtrados.filter(e => e.tipo === 'Visitante' || e.tipo === 'Prestador');
      } else {
        filtrados = filtrados.filter(e => e.tipo === filtro);
      }
    }

    // 2. Filtro por direção (Entrada/Saída)
    if (direcao !== 'todos') {
      filtrados = filtrados.filter(e => e.direcao === direcao);
    }

    // 3. Filtro de pesquisa de texto
    if (busca) {
      filtrados = filtrados.filter(e => {
        const descricao = e.descricao ? e.descricao.toLowerCase() : '';
        const tipo = e.tipo ? e.tipo.toLowerCase() : '';
        const apto = e.detalhes?.blocoApto ? e.detalhes.blocoApto.toLowerCase() : '';
        const nome = e.detalhes?.nome ? e.detalhes.nome.toLowerCase() : '';
        
        return descricao.includes(busca) || 
               tipo.includes(busca) || 
               apto.includes(busca) || 
               nome.includes(busca);
      });
    }

    return filtrados;
  });

  toggleMaximizacao() {
    this.eventosMaximizados.update(v => !v);
    if (!this.eventosMaximizados()) {
      this.buscaTexto.set('');
      this.filtroDirecao.set('todos');
    }
  }

  limparFiltros() {
    this.buscaTexto.set('');
    this.filtroDirecao.set('todos');
    this.filtroEvento.set('Todos');
  }

  onEscapePressed() {
    if (this.eventosMaximizados()) {
      this.toggleMaximizacao();
    }
  }

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

  tipoColor(evento: any): string {
    const direcao = evento?.direcao;
    const tipo = typeof evento === 'string' ? evento : (evento?.tipo ?? '');

    if (direcao === 'entrada') {
      return 'text-emerald-550 bg-emerald-500/10 border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20';
    } else if (direcao === 'saida') {
      return 'text-rose-550 bg-rose-500/10 border-rose-500/20 dark:text-rose-400 dark:bg-rose-400/10 dark:border-rose-400/20';
    }

    if (tipo === 'Visitante' || tipo === 'Prestador') {
      return tipo === 'Prestador'
        ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
        : 'text-accent bg-accent/10 border-accent/20';
    }
    return tipo === 'Encomenda' ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
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
