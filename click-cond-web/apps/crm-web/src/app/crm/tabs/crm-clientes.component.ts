import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmCliente } from '../crm.service';
import { CrmStore } from '../crm.store';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { EstagioFiltro, Ordenacao } from '../crm.models';
import * as fmt from '../crm-format';

/**
 * Aba Clientes: diretório de condomínios com busca (debounced), filtro por
 * estágio e ordenação. Tabela (≥md) e cards (<md) leem o mesmo computed.
 * O drawer de detalhe vive no componente pai, alimentado pelo CrmStore.
 */
@Component({
  selector: 'crm-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent, SkeletonComponent],
  templateUrl: './crm-clientes.component.html',
})
export class CrmClientesComponent implements OnInit {
  readonly store = inject(CrmStore);

  readonly iniciais = fmt.iniciais;
  readonly moeda = fmt.moeda;
  readonly estagioLabel = fmt.estagioLabel;
  readonly estagioClasse = fmt.estagioClasse;
  readonly pagamentoClasse = fmt.pagamentoClasse;
  readonly riscoLabel = fmt.riscoLabel;
  readonly riscoClasse = fmt.riscoClasse;
  readonly healthClasse = fmt.healthClasse;
  readonly healthBg = fmt.healthBg;

  readonly busca = signal('');       // termo aplicado ao filtro (debounced)
  readonly buscaRaw = signal('');    // valor imediato do input
  private buscaTimer: ReturnType<typeof setTimeout> | null = null;
  readonly filtroEstagio = signal<EstagioFiltro>('todos');
  readonly ordenacao = signal<Ordenacao>('mrr');

  readonly estagios: { valor: EstagioFiltro; label: string }[] = [
    { valor: 'todos', label: 'Todos' },
    { valor: 'ativo', label: 'Ativos' },
    { valor: 'trial', label: 'Trial' },
    { valor: 'em_atraso', label: 'Em atraso' },
    { valor: 'lead', label: 'Leads' },
    { valor: 'churn', label: 'Churn' },
  ];

  readonly clientesFiltrados = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    const estagio = this.filtroEstagio();
    const ord = this.ordenacao();

    const lista = this.store.clientes().filter((c) => {
      const matchEstagio = estagio === 'todos' || c.estagio === estagio;
      const matchBusca =
        !termo ||
        c.nome.toLowerCase().includes(termo) ||
        (c.cidade ?? '').toLowerCase().includes(termo) ||
        (c.identificacao ?? '').toLowerCase().includes(termo) ||
        (c.contatoPrincipal?.nome ?? '').toLowerCase().includes(termo);
      return matchEstagio && matchBusca;
    });

    return [...lista].sort((a, b) => {
      switch (ord) {
        case 'health':
          return b.healthScore - a.healthScore;
        case 'nome':
          return a.nome.localeCompare(b.nome);
        case 'vencimento':
          return (a.diasParaVencer ?? 9999) - (b.diasParaVencer ?? 9999);
        default:
          return b.mrr - a.mrr;
      }
    });
  });

  /** Há filtros ativos? (usado no empty state para oferecer "limpar") */
  readonly temFiltros = computed(() => !!this.busca() || this.filtroEstagio() !== 'todos');

  /**
   * Quantos clientes há em cada estágio — exibido dentro do filtro segmentado.
   * Todos os estágios são semeados com 0 para que o contador nunca fique vazio.
   */
  readonly contagemEstagios = computed(() => {
    const lista = this.store.clientes();
    const mapa: Record<string, number> = {};
    for (const e of this.estagios) mapa[e.valor] = 0;
    mapa['todos'] = lista.length;
    for (const c of lista) mapa[c.estagio] = (mapa[c.estagio] ?? 0) + 1;
    return mapa;
  });

  /** Soma do MRR do recorte visível — resumo do topo do diretório. */
  readonly mrrFiltrado = computed(() => this.clientesFiltrados().reduce((s, c) => s + c.mrr, 0));

  /** Consome o termo digitado na busca global do cabeçalho, se houver. */
  ngOnInit(): void {
    const termo = this.store.buscaGlobal();
    if (!termo) return;
    this.buscaRaw.set(termo);
    this.busca.set(termo);
    this.store.buscaGlobal.set('');
  }

  /** Circunferência do anel de health score (r = 14 no viewBox 32). */
  readonly CIRC_HEALTH = 2 * Math.PI * 14;

  /** Traço do anel proporcional ao score (0–100). */
  dashHealth(score: number): string {
    const preenchido = (Math.max(0, Math.min(100, score)) / 100) * this.CIRC_HEALTH;
    return `${preenchido} ${this.CIRC_HEALTH - preenchido}`;
  }

  /** Cor do traço do anel — acompanha healthClasse(). */
  corHealth(score: number): string {
    if (score >= 70) return 'var(--success)';
    if (score >= 40) return 'var(--warning)';
    return 'var(--danger)';
  }

  @ViewChild('buscaInput') buscaInputEl?: ElementRef<HTMLInputElement>;

  /** Atalho: "/" foca a busca (quando não está digitando em outro campo). */
  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key !== '/' || this.store.clienteSelecionado()) return;
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    e.preventDefault();
    this.buscaInputEl?.nativeElement.focus();
  }

  onBuscaInput(v: string): void {
    this.buscaRaw.set(v);
    if (this.buscaTimer) clearTimeout(this.buscaTimer);
    this.buscaTimer = setTimeout(() => this.busca.set(v), 200);
  }

  limparBusca(): void {
    if (this.buscaTimer) clearTimeout(this.buscaTimer);
    this.buscaRaw.set('');
    this.busca.set('');
  }

  limparFiltros(): void {
    this.limparBusca();
    this.filtroEstagio.set('todos');
  }

  abrirCliente(c: CrmCliente): void {
    this.store.abrirCliente(c);
  }
}
