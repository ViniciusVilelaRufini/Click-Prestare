import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

  readonly visitantes = signal<Visitante[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly viewFilter = signal<'todos' | 'ativos' | 'historico'>('todos');

  readonly showValidationModal = signal(false);
  readonly pinCode = signal('');
  readonly validationResult = signal<any | null>(null);
  readonly validationError = signal<string | null>(null);
  readonly validating = signal(false);
  readonly checkingIn = signal(false);

  readonly visitantesAtivos = computed(() =>
    this.visitantes().filter((v) => !v.data_hora_termino),
  );
  readonly visitantesHistorico = computed(() =>
    this.visitantes().filter((v) => !!v.data_hora_termino),
  );
  readonly visitantesFiltrados = computed(() => {
    const f = this.viewFilter();
    if (f === 'ativos') return this.visitantesAtivos();
    if (f === 'historico') return this.visitantesHistorico();
    return this.visitantes();
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
  }

  carregar() {
    this.loading.set(true);
    this.error.set(null);
    this.service.list(this.search() || undefined).subscribe({
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

  iniciais(nome: string): string {
    return nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
  }

  duracao(v: Visitante): string {
    // Usa a entrada/saída real se disponível, senão usa o período agendado
    const inicio = v.data_entrada
      ? new Date(v.data_entrada).getTime()
      : v.data_hora_inicio
      ? new Date(v.data_hora_inicio).getTime()
      : null;
    if (!inicio) return '—';
    const fim = v.data_saida
      ? new Date(v.data_saida).getTime()
      : v.data_hora_termino
      ? new Date(v.data_hora_termino).getTime()
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
