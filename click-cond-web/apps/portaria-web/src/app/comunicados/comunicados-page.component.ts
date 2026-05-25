import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Comunicado, ComunicadosApi, CreateComunicado } from './comunicados.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-comunicados-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comunicados-page.component.html',
})
export class ComunicadosPageComponent implements OnInit {
  private api = inject(ComunicadosApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);

  readonly comunicados = signal<Comunicado[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  showForm = false;
  editingId: number | null = null;
  form: CreateComunicado = { titulo: '', descricao: '' };

  readonly ultimo = computed(() => this.comunicados()[0] ?? null);
  readonly recentes = computed(
    () => this.comunicados().filter((c) => this.isRecent(c)).length,
  );

  ngOnInit() {
    this.carregar();
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.abrirNovo();
      }
    });
  }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => {
        this.comunicados.set(data);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.message ?? 'Falha ao carregar comunicados.');
        this.loading.set(false);
      },
    });
  }

  abrirNovo() {
    this.editingId = null;
    this.form = { titulo: '', descricao: '' };
    this.error.set(null);
    this.showForm = true;
  }

  abrirEditar(c: Comunicado) {
    this.editingId = c.id;
    this.form = { titulo: c.titulo, descricao: c.descricao ?? '' };
    this.error.set(null);
    this.showForm = true;
  }

  cancelar() {
    this.showForm = false;
    this.editingId = null;
    this.error.set(null);
  }

  salvar() {
    if (!this.form.titulo?.trim()) {
      this.error.set('Título é obrigatório.');
      return;
    }
    const payload: CreateComunicado = {
      titulo: this.form.titulo.trim(),
      descricao: this.form.descricao?.trim() ?? '',
    };
    this.saving.set(true);
    const obs = this.editingId
      ? this.api.update(this.editingId, payload)
      : this.api.create(payload);

    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelar();
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? 'Falha ao salvar comunicado.');
      },
    });
  }

  async remover(c: Comunicado) {
    const ok = await this.confirm.ask({
      title: 'Excluir comunicado',
      message: `O comunicado "${c.titulo}" será removido permanentemente.`,
      confirmLabel: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(c.id).subscribe({
      next: () => this.carregar(),
      error: (e) =>
        this.error.set(e?.error?.message ?? 'Falha ao excluir comunicado.'),
    });
  }

  isRecent(c: Comunicado): boolean {
    const created = new Date(c.created_at).getTime();
    return Date.now() - created < 7 * 86400000;
  }
}
