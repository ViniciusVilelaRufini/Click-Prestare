import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmCliente } from '../crm.service';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ModalShellComponent } from '../../shared/ui/modal-shell.component';
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
  imports: [CommonModule, FormsModule, EmptyStateComponent, SkeletonComponent, ModalShellComponent],
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

  // ════════════ Novo condomínio ════════════

  private readonly toast = inject(ToastService);

  readonly modalNovoAberto = signal(false);
  /** Senha do síndico devolvida pela API — exibida uma única vez. */
  readonly senhaGerada = signal<{ nome: string; email: string; senha: string } | null>(null);

  novo = {
    nome: '',
    identificacao: '',
    plano: 'Profissional',
    valorMensal: 0,
    diaVencimento: 10,
    comSindico: false,
    sindicoNome: '',
    sindicoEmail: '',
    sindicoTelefone: '',
    sindicoDocumento: '',
    comApartamentos: false,
    blocos: 'A',
    andares: 4,
    porAndar: 4,
  };

  blocosLista(): string[] {
    return this.novo.blocos
      .split(',')
      .map((b) => b.trim())
      .filter(Boolean);
  }

  totalAptosPrevisto(): number {
    if (!this.novo.comApartamentos) return 0;
    return this.blocosLista().length * Number(this.novo.andares || 0) * Number(this.novo.porAndar || 0);
  }

  abrirNovo(): void {
    this.novo = {
      nome: '', identificacao: '', plano: 'Profissional', valorMensal: 0, diaVencimento: 10,
      comSindico: false, sindicoNome: '', sindicoEmail: '', sindicoTelefone: '', sindicoDocumento: '',
      comApartamentos: false, blocos: 'A', andares: 4, porAndar: 4,
    };
    this.senhaGerada.set(null);
    this.modalNovoAberto.set(true);
  }

  fecharNovo(): void {
    this.modalNovoAberto.set(false);
  }

  podeSalvarNovo(): boolean {
    if (!this.novo.nome.trim()) return false;
    if (this.novo.comSindico && (!this.novo.sindicoNome.trim() || !this.novo.sindicoEmail.trim())) return false;
    if (this.novo.comApartamentos && this.totalAptosPrevisto() < 1) return false;
    return true;
  }

  salvarNovo(): void {
    if (!this.podeSalvarNovo()) {
      this.toast.trigger('Preencha o nome do condomínio e os campos marcados.', 'error');
      return;
    }
    if (this.totalAptosPrevisto() > 2000) {
      this.toast.trigger('A combinação geraria mais de 2000 apartamentos. Reduza blocos, andares ou unidades.', 'error');
      return;
    }

    this.store
      .criarCondominio({
        nome: this.novo.nome.trim(),
        identificacao: this.novo.identificacao.trim() || null,
        plano: this.novo.plano,
        valorMensal: Number(this.novo.valorMensal) || 0,
        diaVencimento: Number(this.novo.diaVencimento) || 10,
        sindico: this.novo.comSindico
          ? {
              nome: this.novo.sindicoNome.trim(),
              email: this.novo.sindicoEmail.trim(),
              telefone: this.novo.sindicoTelefone.trim() || null,
              documento: this.novo.sindicoDocumento.trim() || null,
            }
          : null,
        apartamentos: this.novo.comApartamentos
          ? {
              blocos: this.blocosLista(),
              andares: Number(this.novo.andares),
              porAndar: Number(this.novo.porAndar),
            }
          : null,
      })
      .subscribe({
        next: (r) => {
          // A senha só volta nesta resposta. Se o modal fechar sem mostrá-la,
          // não há como recuperá-la depois — só redefinir.
          if (r.senhaSindico) {
            this.senhaGerada.set({
              nome: this.novo.sindicoNome.trim(),
              email: this.novo.sindicoEmail.trim(),
              senha: r.senhaSindico,
            });
          } else {
            this.fecharNovo();
          }
        },
        error: () => { /* toast já disparado pelo store */ },
      });
  }

  copiarSenha(): void {
    const dados = this.senhaGerada();
    if (!dados) return;
    navigator.clipboard
      ?.writeText(`Acesso Click Prestare\nLogin: ${dados.email}\nSenha: ${dados.senha}`)
      .then(() => this.toast.trigger('Credenciais copiadas.', 'success'))
      .catch(() => this.toast.trigger('Não foi possível copiar.', 'error'));
  }
}
