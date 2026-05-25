import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  Categoria, CreateOcorrencia, Ocorrencia, OcorrenciaStatus, OcorrenciasApi,
} from './ocorrencias.service';
import { ConfirmService } from '../shared/confirm.service';

@Component({
  selector: 'app-ocorrencias-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ocorrencias-page.component.html',
})
export class OcorrenciasPageComponent implements OnInit {
  private api = inject(OcorrenciasApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);

  readonly ocorrencias = signal<Ocorrencia[]>([]);
  readonly categorias = signal<Categoria[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filtroStatus = signal<string>('');

  readonly ocorrenciasFiltradas = computed(() => {
    const list = this.ocorrencias();
    const f = this.filtroStatus();
    if (!f) return list;
    return list.filter(o => o.status === f);
  });

  readonly stats = computed(() => {
    const list = this.ocorrencias();
    return {
      total: list.length,
      pendentes: list.filter((o) => o.status === 'Pendente').length,
      cientes: list.filter((o) => o.status === 'Ciente').length,
      solucionadas: list.filter((o) => o.status === 'Solucionado').length,
    };
  });

  novo: CreateOcorrencia = { descricao: '', tipo: 0 };
  showForm = false;

  ngOnInit() {
    this.api.categorias().subscribe({
      next: (cats) => {
        this.categorias.set(cats);
        if (cats.length > 0) this.novo.tipo = cats[0].id;
      },
    });
    this.carregar();
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.showForm = true;
      }
    });
  }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => { this.ocorrencias.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
  }

  registrar() {
    if (!this.novo.descricao?.trim() || !this.novo.tipo) {
      this.error.set('Descrição e categoria são obrigatórios.');
      return;
    }
    this.api.create(this.novo).subscribe({
      next: () => {
        this.showForm = false;
        this.novo = { descricao: '', tipo: this.categorias()[0]?.id ?? 0 };
        this.carregar();
      },
      error: (e) => this.error.set(e?.message ?? 'Erro'),
    });
  }

  mudarStatus(o: Ocorrencia, status: OcorrenciaStatus) {
    this.api.updateStatus(o.id, status).subscribe({ next: () => this.carregar() });
  }

  async remover(o: Ocorrencia) {
    const ok = await this.confirm.ask({
      title: 'Remover ocorrência',
      message: 'A ocorrência será removida do histórico.',
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(o.id).subscribe({ next: () => this.carregar() });
  }

  statusBadge(s: OcorrenciaStatus) {
    if (s === 'Pendente') return { bg: 'bg-amber-400/10', border: 'border-amber-400/20', text: 'text-amber-400', dot: 'bg-amber-400 animate-pulse' };
    if (s === 'Ciente')   return { bg: 'bg-accent/10',    border: 'border-accent/20',    text: 'text-accent',    dot: 'bg-accent' };
    return { bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', text: 'text-emerald-400', dot: 'bg-emerald-400' };
  }

  prioridadeCategoria(catId: number): number {
    return this.categorias().find((c) => c.id === catId)?.prioridade ?? 999;
  }

  prioridadeLabel(p: number): { label: string; color: string } {
    if (p <= 1) return { label: 'Crítica', color: 'text-red-400' };
    if (p <= 2) return { label: 'Alta', color: 'text-amber-400' };
    if (p <= 3) return { label: 'Média', color: 'text-accent' };
    return { label: 'Baixa', color: 'text-slate-400' };
  }
}
