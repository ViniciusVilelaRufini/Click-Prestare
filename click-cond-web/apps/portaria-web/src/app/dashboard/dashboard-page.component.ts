import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DashboardApi, DashboardSummary } from './dashboard.service';
import { AuthService } from '../auth/auth.service';
import { VisitantesService, Pessoa } from '../visitantes/visitantes.service';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './dashboard-page.component.html',
  host: {
    '(window:keydown.escape)': 'onEscapePressed()'
  }
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  private api = inject(DashboardApi);
  readonly auth = inject(AuthService);
  private visitantesService = inject(VisitantesService);
  private aptosService = inject(ApartamentosApi);

  readonly data = signal<DashboardSummary | null>(null);
  readonly loading = signal(true);
  readonly agora = signal(new Date());
  readonly eventoSelecionado = signal<any | null>(null);
  readonly filtroEvento = signal<string>('Todos');
  readonly eventosMaximizados = signal(false);
  readonly buscaTexto = signal('');
  readonly filtroDirecao = signal<'todos' | 'entrada' | 'saida'>('todos');
  readonly modoCompacto = signal(false);
  readonly fotoAmpliadaUrl = signal<string | null>(null);
  readonly fotoAmpliadaTitulo = signal<string>('');

  // Estados do Modal de Liberação Rápida
  readonly showLiberarModal = signal(false);
  readonly buscaPessoa = signal('');
  readonly pessoasEncontradas = signal<Pessoa[]>([]);
  readonly pessoaSelecionada = signal<Pessoa | null>(null);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly idApartamentoSelecionado = signal<number | null>(null);
  readonly carregandoPessoas = signal(false);
  readonly liberandoVisitante = signal(false);
  readonly erroLiberar = signal<string | null>(null);
  readonly sucessoLiberar = signal<string | null>(null);

  abrirModalLiberar() {
    this.showLiberarModal.set(true);
    this.buscaPessoa.set('');
    this.pessoasEncontradas.set([]);
    this.pessoaSelecionada.set(null);
    this.idApartamentoSelecionado.set(null);
    this.erroLiberar.set(null);
    this.sucessoLiberar.set(null);

    // Carrega a lista de apartamentos se estiver vazia
    if (this.apartamentos().length === 0) {
      this.aptosService.list().subscribe({
        next: (data) => this.apartamentos.set(data),
        error: (e) => this.erroLiberar.set('Falha ao carregar apartamentos: ' + (e?.message ?? e)),
      });
    }
  }

  fecharModalLiberar() {
    this.showLiberarModal.set(false);
    this.buscaPessoa.set('');
    this.pessoasEncontradas.set([]);
    this.pessoaSelecionada.set(null);
    this.idApartamentoSelecionado.set(null);
    this.erroLiberar.set(null);
    this.sucessoLiberar.set(null);
  }

  onPesquisarPessoa() {
    const termo = this.buscaPessoa().trim();
    if (termo.length < 2) {
      this.pessoasEncontradas.set([]);
      return;
    }
    this.carregandoPessoas.set(true);
    this.visitantesService.listarPessoas(termo).subscribe({
      next: (data) => {
        this.pessoasEncontradas.set(data);
        this.carregandoPessoas.set(false);
      },
      error: (e) => {
        this.erroLiberar.set('Falha ao buscar visitantes: ' + (e?.message ?? e));
        this.carregandoPessoas.set(false);
      }
    });
  }

  selecionarPessoa(p: Pessoa) {
    this.pessoaSelecionada.set(p);
    this.erroLiberar.set(null);
    if (p.id_apartamento) {
      this.idApartamentoSelecionado.set(p.id_apartamento);
    } else if (p.apartamentosVisitados && p.apartamentosVisitados.length > 0) {
      this.idApartamentoSelecionado.set(p.apartamentosVisitados[0].id);
    } else {
      this.idApartamentoSelecionado.set(null);
    }
  }

  confirmarLiberacao() {
    const p = this.pessoaSelecionada();
    const idApto = this.idApartamentoSelecionado();
    if (!p) return;
    if (!idApto) {
      this.erroLiberar.set('Selecione o apartamento de destino.');
      return;
    }

    this.liberandoVisitante.set(true);
    this.erroLiberar.set(null);

    this.visitantesService.novaVisitaPessoa(p.id, {
      id_apartamento: idApto
    }).subscribe({
      next: (visitanteCriado) => {
        this.visitantesService.checkIn(visitanteCriado.id).subscribe({
          next: () => {
            this.liberandoVisitante.set(false);
            this.sucessoLiberar.set(`Acesso de ${p.nome} liberado com sucesso!`);
            this.load();
            setTimeout(() => {
              this.fecharModalLiberar();
            }, 2000);
          },
          error: (e) => {
            this.liberandoVisitante.set(false);
            this.erroLiberar.set('A visita foi cadastrada, mas falhou ao registrar a entrada: ' + (e?.error?.message ?? e?.message ?? e));
          }
        });
      },
      error: (e) => {
        this.liberandoVisitante.set(false);
        this.erroLiberar.set('Falha ao criar visita: ' + (e?.error?.message ?? e?.message ?? e));
      }
    });
  }

  abrirAmpliarFoto(url: string, titulo: string) {
    this.fotoAmpliadaUrl.set(url);
    this.fotoAmpliadaTitulo.set(titulo);
  }

  fecharAmpliarFoto() {
    this.fotoAmpliadaUrl.set(null);
    this.fotoAmpliadaTitulo.set('');
  }

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
        filtrados = filtrados.filter(e => 
          e.tipo === 'Visitante' || 
          e.tipo === 'Prestador' || 
          (e.tipo === 'Acesso Facial' && (e.detalhes?.tipoPessoa === 'visitante' || e.detalhes?.tipoPessoa === 'prestador'))
        );
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
    if (this.showLiberarModal()) {
      this.fecharModalLiberar();
    }
  }

  private clockInterval?: ReturnType<typeof setInterval>;
  private refreshInterval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.load();
    this.clockInterval = setInterval(() => this.agora.set(new Date()), 1000);
    // Atualiza eventos do dashboard a cada 10s para refletir acessos faciais
    // e outros eventos em near-real-time
    this.refreshInterval = setInterval(() => this.load(), 10_000);

    // Também recarrega quando a aba volta a ficar visível
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.load();
    }
  };

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
    } else if (direcao === 'negado' || direcao === 'bloqueado') {
      return 'text-rose-600 bg-rose-500/10 border-rose-500/20 dark:text-rose-400 dark:bg-rose-500/10 dark:border-rose-500/20';
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
