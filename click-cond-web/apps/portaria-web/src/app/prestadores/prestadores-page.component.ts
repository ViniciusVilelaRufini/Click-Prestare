import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CreatePrestador, Prestador, PrestadoresApi } from './prestadores.service';
import { ConfirmService } from '../shared/confirm.service';
import { InputMaskDirective } from '../shared/input-mask.directive';
import { VisitantesService } from '../visitantes/visitantes.service';
import { Visitante } from '../visitantes/visitante.model';

@Component({
  selector: 'app-prestadores-page',
  standalone: true,
  imports: [CommonModule, FormsModule, InputMaskDirective],
  templateUrl: './prestadores-page.component.html',
})
export class PrestadoresPageComponent implements OnInit {
  private api = inject(PrestadoresApi);
  private confirm = inject(ConfirmService);
  private visitantesApi = inject(VisitantesService);

  constructor() {
    effect(() => {
      this.filtroCategoria();
      this.search();
      untracked(() => {
        this.pagina.set(1);
      });
    });
  }

  readonly prestadores = signal<Prestador[]>([]);
  readonly visitantes = signal<Visitante[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly filtroCategoria = signal<string>('');

  readonly detalhesPrestador = signal<Prestador | null>(null);
  readonly categoriasSelecionadas = signal<Set<string>>(new Set());
  readonly categoriasPredefinidas = [
    'Elétrica',
    'Hidráulica',
    'Reformas',
    'Pintura',
    'Jardinagem',
    'Limpeza',
    'Segurança',
    'Marcenaria',
    'Ar Condicionado',
    'Chaveiro'
  ];

  readonly categoriasCustomSelecionadas = computed(() => {
    return Array.from(this.categoriasSelecionadas()).filter(
      (c) => !this.categoriasPredefinidas.includes(c)
    );
  });

  readonly historicoVisitas = computed(() => {
    const p = this.detalhesPrestador();
    if (!p) return [];
    return this.visitantes().filter(
      (v) =>
        v.is_prestador === 1 &&
        v.nome.toLowerCase().trim() === p.nome.toLowerCase().trim()
    );
  });

  readonly pagina = signal(1);
  readonly itensPorPagina = 12;

  readonly totalPaginas = computed(() => {
    const total = this.prestadoresFiltrados().length;
    return Math.max(1, Math.ceil(total / this.itensPorPagina));
  });

  readonly prestadoresPaginados = computed(() => {
    const list = this.prestadoresFiltrados();
    const p = this.pagina();
    const start = (p - 1) * this.itensPorPagina;
    const end = start + this.itensPorPagina;
    return list.slice(start, end);
  });

  readonly exibindoInicio = computed(() => {
    if (this.prestadoresFiltrados().length === 0) return 0;
    return (this.pagina() - 1) * this.itensPorPagina + 1;
  });

  readonly exibindoFim = computed(() => {
    return Math.min(this.pagina() * this.itensPorPagina, this.prestadoresFiltrados().length);
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

  readonly categoriasUnicas = computed(() => {
    const set = new Set<string>();
    for (const p of this.prestadores()) {
      for (const c of (p.categorias ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
        set.add(c);
      }
    }
    return Array.from(set).sort();
  });

  readonly prestadoresFiltrados = computed(() => {
    let list = this.prestadores();

    const cat = this.filtroCategoria();
    if (cat) {
      list = list.filter((p) =>
        this.categoriasArray(p).some((c) => c.toLowerCase() === cat.toLowerCase())
      );
    }

    const term = this.search().toLowerCase().trim();
    if (term) {
      list = list.filter(
        (p) =>
          p.nome.toLowerCase().includes(term) ||
          (p.telefone && p.telefone.toLowerCase().includes(term)) ||
          (p.categorias && p.categorias.toLowerCase().includes(term))
      );
    }

    return list;
  });

  novo: CreatePrestador = { nome: '', telefone: '', categorias: '' };
  showForm = false;
  editingId: number | null = null;
  readonly saving = signal(false);

  ngOnInit() { this.carregar(); }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => { this.prestadores.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
    this.visitantesApi.list().subscribe({
      next: (data) => { this.visitantes.set(data); }
    });
  }

  abrirNovo() {
    this.editingId = null;
    this.novo = { nome: '', telefone: '', categorias: '' };
    this.categoriasSelecionadas.set(new Set());
    this.error.set(null);
    this.showForm = true;
  }

  abrirEditar(p: Prestador) {
    this.editingId = p.id;
    this.novo = {
      nome: p.nome,
      telefone: p.telefone ?? '',
      categorias: p.categorias ?? '',
    };
    const cats = (p.categorias ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    this.categoriasSelecionadas.set(new Set(cats));
    this.error.set(null);
    this.showForm = true;
  }

  cancelarForm() {
    this.showForm = false;
    this.editingId = null;
    this.error.set(null);
  }

  salvar() {
    if (!this.novo.nome?.trim()) { this.error.set('Nome é obrigatório.'); return; }
    
    this.novo.categorias = Array.from(this.categoriasSelecionadas()).join(';');
    
    this.saving.set(true);
    const obs = this.editingId
      ? this.api.update(this.editingId, this.novo)
      : this.api.create(this.novo);
    obs.subscribe({
      next: () => {
        this.saving.set(false);
        this.cancelarForm();
        this.novo = { nome: '', telefone: '', categorias: '' };
        this.carregar();
      },
      error: (e) => {
        this.saving.set(false);
        this.error.set(e?.error?.message ?? e?.message ?? 'Erro');
      },
    });
  }

  async remover(p: Prestador) {
    const ok = await this.confirm.ask({
      title: 'Remover prestador',
      message: `${p.nome} será removido da lista de autorizados.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(p.id).subscribe({ next: () => this.carregar() });
  }

  toggleCategoriaSelecionada(cat: string) {
    const current = new Set(this.categoriasSelecionadas());
    if (current.has(cat)) {
      current.delete(cat);
    } else {
      current.add(cat);
    }
    this.categoriasSelecionadas.set(current);
  }

  adicionarCustomCategoria(val: string) {
    const clean = val.trim();
    if (!clean) return;
    const formatted = clean.charAt(0).toUpperCase() + clean.slice(1);
    const current = new Set(this.categoriasSelecionadas());
    current.add(formatted);
    this.categoriasSelecionadas.set(current);
  }

  copiarTelefone(tel: string) {
    navigator.clipboard.writeText(tel);
  }

  limparTelefone(tel: string): string {
    return tel.replace(/\D/g, '');
  }

  categoriasArray(p: Prestador): string[] {
    return (p.categorias ?? '').split(';').map((c) => c.trim()).filter(Boolean);
  }

  iniciais(nome: string): string {
    return nome.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
  }
}
