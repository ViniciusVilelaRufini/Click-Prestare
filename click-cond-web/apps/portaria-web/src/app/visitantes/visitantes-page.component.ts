import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { VisitantesService } from './visitantes.service';
import { ApartamentosApi, Apartamento } from '../apartamentos/apartamentos.service';
import { CreateVisitante, Visitante } from './visitante.model';
import { ConfirmService } from '../shared/confirm.service';
import { InputMaskDirective } from '../shared/input-mask.directive';

@Component({
  selector: 'app-visitantes-page',
  standalone: true,
  imports: [CommonModule, FormsModule, InputMaskDirective],
  templateUrl: './visitantes-page.component.html',
  styleUrl: './visitantes-page.component.css',
})
export class VisitantesPageComponent implements OnInit {
  private service = inject(VisitantesService);
  private aptApi = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);

  constructor() {
    effect(() => {
      this.viewFilter();
      this.tipoFilter();
      this.search();
      untracked(() => {
        this.pagina.set(1);
      });
    });
  }

  readonly visitantes = signal<Visitante[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly viewFilter = signal<'todos' | 'ativos' | 'historico'>('todos');
  readonly tipoFilter = signal<'todos' | 'visitante' | 'prestador'>('todos');
  readonly pinsRevelados = signal<Set<number>>(new Set());

  readonly showValidationModal = signal(false);
  readonly pinCode = signal('');
  readonly validationResult = signal<any | null>(null);
  readonly validationError = signal<string | null>(null);
  readonly validating = signal(false);
  readonly checkingIn = signal(false);

  readonly pagina = signal(1);
  readonly itensPorPagina = 20;

  readonly totalPaginas = computed(() => {
    const total = this.visitantesFiltrados().length;
    return Math.max(1, Math.ceil(total / this.itensPorPagina));
  });

  readonly visitantesPaginados = computed(() => {
    const list = this.visitantesFiltrados();
    const p = this.pagina();
    const start = (p - 1) * this.itensPorPagina;
    const end = start + this.itensPorPagina;
    return list.slice(start, end);
  });

  readonly exibindoInicio = computed(() => {
    if (this.visitantesFiltrados().length === 0) return 0;
    return (this.pagina() - 1) * this.itensPorPagina + 1;
  });

  readonly exibindoFim = computed(() => {
    return Math.min(this.pagina() * this.itensPorPagina, this.visitantesFiltrados().length);
  });

  readonly paginasLista = computed(() => {
    const current = this.pagina();
    const total = this.totalPaginas();
    const list: number[] = [];
    
    if (total <= 5) {
      for (let i = 1; i <= total; i++) list.push(i);
    } else {
      list.push(1);
      
      if (current > 3) {
        list.push(-1);
      }
      
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      
      for (let i = start; i <= end; i++) {
        if (!list.includes(i)) list.push(i);
      }
      
      if (current < total - 2) {
        list.push(-1);
      }
      
      if (!list.includes(total)) list.push(total);
    }
    return list;
  });

  readonly visitantesAtivos = computed(() =>
    this.visitantes().filter((v) => !!v.data_entrada && !v.data_saida),
  );
  readonly visitantesHistorico = computed(() =>
    this.visitantes().filter((v) => !v.data_entrada || !!v.data_saida),
  );
  readonly visitantesFiltrados = computed(() => {
    let list = this.visitantes();
    
    // 1. Filtrar por status
    const f = this.viewFilter();
    if (f === 'ativos') {
      list = list.filter((v) => !!v.data_entrada && !v.data_saida);
    } else if (f === 'historico') {
      list = list.filter((v) => !v.data_entrada || !!v.data_saida);
    }

    // 2. Filtrar por tipo (visitante vs prestador)
    const t = this.tipoFilter();
    if (t === 'visitante') {
      list = list.filter((v) => !v.is_prestador);
    } else if (t === 'prestador') {
      list = list.filter((v) => !!v.is_prestador);
    }

    // 3. Filtrar por busca (tempo real)
    const term = this.search().toLowerCase().trim();
    if (term) {
      list = list.filter((v) => 
        v.nome.toLowerCase().includes(term) ||
        (v.doc_identificacao && v.doc_identificacao.toLowerCase().includes(term)) ||
        (v.apto && v.apto.toLowerCase().includes(term)) ||
        (v.apto_bloco && v.apto_bloco.toLowerCase().includes(term))
      );
    }

    return list;
  });

  novo: CreateVisitante = this.estadoInicial();
  showForm = false;
  editingId: number | null = null;
  readonly saving = signal(false);

  ngOnInit() {
    this.carregar();
    this.aptApi.list().subscribe({
      next: (data) => this.apartamentos.set(data),
    });
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.abrirNovo();
      }
    });
  }

  carregar() {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (data) => {
        this.visitantes.set(data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(`Falha ao carregar: ${e?.message ?? e}`);
        this.loading.set(false);
      },
    });
  }

  abrirNovo() {
    this.editingId = null;
    this.novo = this.estadoInicial();
    this.error.set(null);
    this.showForm = true;
  }

  abrirEditar(v: Visitante) {
    this.editingId = v.id;
    this.novo = {
      nome: v.nome,
      doc_identificacao: v.doc_identificacao ?? '',
      id_apartamento: v.id_apartamento,
      is_visitante: v.is_visitante ?? 1,
      is_prestador: v.is_prestador ?? 0,
      data_hora_inicio: v.data_hora_inicio
        ? new Date(v.data_hora_inicio).toISOString().slice(0, 16)
        : undefined,
      data_hora_termino: v.data_hora_termino
        ? new Date(v.data_hora_termino).toISOString().slice(0, 16)
        : undefined,
    } as CreateVisitante;
    this.error.set(null);
    this.showForm = true;
  }

  cancelarForm() {
    this.showForm = false;
    this.editingId = null;
    this.error.set(null);
  }

  salvar() {
    if (!this.novo.nome?.trim() || !this.novo.id_apartamento) {
      this.error.set('Informe nome e selecione o apartamento.');
      return;
    }
    this.saving.set(true);
    const obs = this.editingId
      ? this.service.update(this.editingId, this.novo)
      : this.service.create(this.novo);
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelarForm();
        this.novo = this.estadoInicial();
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(`Falha ao salvar: ${e?.error?.message ?? e?.message ?? e}`);
      },
    });
  }

  async remover(v: Visitante) {
    const ok = await this.confirm.ask({
      title: 'Remover visitante',
      message: `Remover o registro de ${v.nome}?`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.service.remove(v.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.error.set(`Falha ao remover: ${e?.message ?? e}`),
    });
  }

  async darBaixa(v: Visitante) {
    const ok = await this.confirm.ask({
      title: 'Dar baixa (Saída)',
      message: `Confirmar a saída de ${v.nome}?`,
      confirmLabel: 'Confirmar Saída',
      variant: 'primary',
    });
    if (!ok) return;
    this.service.checkOut(v.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.error.set(`Falha ao registrar saída: ${e?.message ?? e}`),
    });
  }

  async registrarEntradaManual(v: Visitante) {
    const ok = await this.confirm.ask({
      title: 'Registrar Entrada',
      message: `Confirmar a entrada de ${v.nome}?`,
      confirmLabel: 'Confirmar Entrada',
      variant: 'primary',
    });
    if (!ok) return;
    this.service.checkIn(v.id).subscribe({
      next: () => this.carregar(),
      error: (e) => this.error.set(`Falha ao registrar entrada: ${e?.message ?? e}`),
    });
  }

  iniciais(nome: string): string {
    return nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
  }

  togglePin(id: number, event: Event) {
    event.stopPropagation();
    const current = new Set(this.pinsRevelados());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.pinsRevelados.set(current);
  }

  duracao(v: Visitante): string {
    if (!v.data_entrada) {
      return '—';
    }
    const inicio = new Date(v.data_entrada).getTime();
    const fim = v.data_saida
      ? new Date(v.data_saida).getTime()
      : Date.now();
    const min = Math.floor((fim - inicio) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  }

  getStatusVisitante(v: Visitante): 'presente' | 'autorizado' | 'agendado' | 'saiu' {
    const now = Date.now();
    // 1. Entrou e ainda está dentro (saida não registrada)
    if (v.data_entrada && !v.data_saida) return 'presente';
    // 2. Saída real registrada
    if (v.data_saida) return 'saiu';
    // 3. Dentro do período de liberação (ainda não entrou)
    if (v.data_hora_inicio && v.data_hora_termino) {
      const inicio = new Date(v.data_hora_inicio).getTime();
      const fim = new Date(v.data_hora_termino).getTime();
      if (now >= inicio && now <= fim) return 'autorizado';
    }
    // 4. Agendado (ainda não chegou o horário)
    return 'agendado';
  }

  abrirValidador() {
    this.pinCode.set('');
    this.validationResult.set(null);
    this.validationError.set(null);
    this.showValidationModal.set(true);
  }

  fecharValidador() {
    this.showValidationModal.set(false);
  }

  validarPIN() {
    const code = this.pinCode().trim().replace('-', '');
    if (!code) {
      this.validationError.set('Por favor, informe o código PIN.');
      return;
    }
    
    this.validating.set(true);
    this.validationError.set(null);
    this.validationResult.set(null);
    
    this.service.validarCodigo(code).subscribe({
      next: (res) => {
        this.validationResult.set(res);
        this.validating.set(false);
      },
      error: (err) => {
        this.validationError.set(err?.error?.message || 'Código inválido ou visita não agendada.');
        this.validating.set(false);
      }
    });
  }

  confirmarEntradaPIN() {
    const res = this.validationResult();
    if (!res || !res.id) return;
    
    this.checkingIn.set(true);
    this.service.checkIn(res.id).subscribe({
      next: () => {
        this.checkingIn.set(false);
        this.fecharValidador();
        this.carregar();
      },
      error: (err) => {
        this.validationError.set(err?.error?.message || 'Erro ao registrar entrada.');
        this.checkingIn.set(false);
      }
    });
  }

  private estadoInicial(): CreateVisitante {
    return {
      nome: '',
      doc_identificacao: '',
      id_apartamento: 0,
      is_visitante: 1,
      is_prestador: 0,
    };
  }
}
