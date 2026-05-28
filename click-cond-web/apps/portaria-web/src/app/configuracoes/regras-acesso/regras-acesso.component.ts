import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegrasAcessoService, RegraAcesso, CreateRegraAcesso } from './regras-acesso.service';
import { TerminaisFaciaisApi, TerminalFacial } from '../../terminais-faciais/terminais-faciais.service';

@Component({
  selector: 'app-regras-acesso',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './regras-acesso.component.html',
})
export class RegrasAcessoComponent implements OnInit {
  private regrasApi = inject(RegrasAcessoService);
  private dispositivosApi = inject(TerminaisFaciaisApi);

  readonly loading = signal(false);
  readonly regras = signal<RegraAcesso[]>([]);
  readonly dispositivos = signal<TerminalFacial[]>([]);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  // Modal
  readonly showModal = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly saving = signal(false);

  // Form State
  form = this.emptyForm();
  
  // Mapeamento local dos dispositivos marcados
  selectedDispositivos: Record<number, boolean> = {};

  ngOnInit(): void {
    this.load();
    this.loadDispositivos();
  }

  private emptyForm(): CreateRegraAcesso {
    return {
      nome: '',
      descricao: '',
      permitir_morador: 1,
      permitir_visitante: 0,
      permitir_prestador: 0,
      permitir_funcionario: 0,
      ativo: 1,
      dispositivosIds: [],
    };
  }

  load() {
    this.loading.set(true);
    this.regrasApi.list().subscribe({
      next: (list) => {
        this.regras.set(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Falha ao carregar regras de acesso.');
      },
    });
  }

  loadDispositivos() {
    this.dispositivosApi.list().subscribe({
      next: (list) => this.dispositivos.set(list),
      error: (err) => console.error('Erro ao carregar dispositivos para regras:', err),
    });
  }

  openCreate() {
    this.editingId.set(null);
    this.form = this.emptyForm();
    this.selectedDispositivos = {};
    // Marcar todos por padrão se for nova regra para facilitar
    this.dispositivos().forEach(d => {
      this.selectedDispositivos[d.id] = false;
    });
    this.showModal.set(true);
  }

  openEdit(r: RegraAcesso) {
    this.editingId.set(r.id);
    this.form = {
      nome: r.nome,
      descricao: r.descricao ?? '',
      permitir_morador: r.permitir_morador,
      permitir_visitante: r.permitir_visitante,
      permitir_prestador: r.permitir_prestador,
      permitir_funcionario: r.permitir_funcionario,
      ativo: r.ativo,
      dispositivosIds: r.dispositivos.map(d => d.id_dispositivo),
    };

    // Preencher mapeamento de selecionados
    this.selectedDispositivos = {};
    this.dispositivos().forEach(d => {
      this.selectedDispositivos[d.id] = this.form.dispositivosIds.includes(d.id);
    });

    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.editingId.set(null);
  }

  toggleRegraAtiva(r: RegraAcesso) {
    const novoAtivo = r.ativo === 1 ? 0 : 1;
    this.regrasApi.update(r.id, { ativo: novoAtivo }).subscribe({
      next: () => {
        this.successMessage.set(`Regra "${r.nome}" ${novoAtivo === 1 ? 'ativada' : 'desativada'} com sucesso.`);
        setTimeout(() => this.successMessage.set(null), 3000);
        this.load();
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.message ?? 'Falha ao alterar status da regra.');
        setTimeout(() => this.errorMessage.set(null), 3500);
      },
    });
  }

  save() {
    if (!this.form.nome.trim()) {
      this.errorMessage.set('O nome da regra é obrigatório.');
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    // Mapear os checkboxes para array de IDs
    const dispositivosIds = Object.keys(this.selectedDispositivos)
      .filter(id => this.selectedDispositivos[Number(id)] === true)
      .map(id => Number(id));

    const payload: CreateRegraAcesso = {
      nome: this.form.nome.trim(),
      descricao: this.form.descricao?.trim() || undefined,
      permitir_morador: this.form.permitir_morador ? 1 : 0,
      permitir_visitante: this.form.permitir_visitante ? 1 : 0,
      permitir_prestador: this.form.permitir_prestador ? 1 : 0,
      permitir_funcionario: this.form.permitir_funcionario ? 1 : 0,
      ativo: this.form.ativo ? 1 : 0,
      dispositivosIds,
    };

    const id = this.editingId();
    const obs = id != null ? this.regrasApi.update(id, payload) : this.regrasApi.create(payload);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.successMessage.set(id != null ? 'Regra de acesso atualizada.' : 'Regra de acesso cadastrada.');
        setTimeout(() => this.successMessage.set(null), 4000);
        this.closeModal();
        this.load();
      },
      error: (err) => {
        this.saving.set(false);
        this.errorMessage.set(err?.error?.message ?? 'Falha ao salvar regra de acesso.');
      },
    });
  }

  remove(r: RegraAcesso) {
    if (!confirm(`Tem certeza que deseja excluir a regra de acesso "${r.nome}"?`)) return;

    this.regrasApi.remove(r.id).subscribe({
      next: () => {
        this.successMessage.set('Regra de acesso removida com sucesso.');
        setTimeout(() => this.successMessage.set(null), 4000);
        this.load();
      },
      error: (err) => this.errorMessage.set(err?.error?.message ?? 'Falha ao remover regra.'),
    });
  }
}
