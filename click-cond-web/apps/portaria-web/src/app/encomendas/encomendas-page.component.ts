import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import {
  CreateEncomenda, Encomenda, EncomendasApi,
} from './encomendas.service';
import { ConfirmService } from '../shared/confirm.service';
import { Apartamento, ApartamentosApi } from '../apartamentos/apartamentos.service';

@Component({
  selector: 'app-encomendas-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './encomendas-page.component.html',
})
export class EncomendasPageComponent implements OnInit {
  private api = inject(EncomendasApi);
  private aptosApi = inject(ApartamentosApi);
  private confirm = inject(ConfirmService);
  private route = inject(ActivatedRoute);

  constructor() {
    effect(() => {
      this.filtro();
      this.busca();
      this.filtroTransportadora();
      this.filtroBloco();
      untracked(() => {
        this.pagina.set(1);
        this.selecionadas.set(new Set());
      });
    });
  }

  readonly encomendas = signal<Encomenda[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filtro = signal<string>('');

  readonly busca = signal<string>('');
  readonly filtroTransportadora = signal<string>('');
  readonly filtroBloco = signal<string>('');

  readonly selecionadas = signal<Set<number>>(new Set());
  readonly retirandoEncomenda = signal<Encomenda | null>(null);
  isBatchRetirada = false;

  retiranteNome = '';
  retiranteDocumento = '';
  retiranteParentesco = 'Morador';

  readonly pagina = signal(1);
  readonly itensPorPagina = 20;

  readonly totalPaginas = computed(() => {
    const total = this.encomendasFiltradas().length;
    return Math.max(1, Math.ceil(total / this.itensPorPagina));
  });

  readonly encomendasPaginadas = computed(() => {
    const list = this.encomendasFiltradas();
    const p = this.pagina();
    const start = (p - 1) * this.itensPorPagina;
    const end = start + this.itensPorPagina;
    return list.slice(start, end);
  });

  readonly exibindoInicio = computed(() => {
    if (this.encomendasFiltradas().length === 0) return 0;
    return (this.pagina() - 1) * this.itensPorPagina + 1;
  });

  readonly exibindoFim = computed(() => {
    return Math.min(this.pagina() * this.itensPorPagina, this.encomendasFiltradas().length);
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

  readonly transportadorasDisponiveis = computed(() => {
    const list = this.encomendas();
    const set = new Set<string>();
    list.forEach(e => {
      if (e.recebido_de?.trim()) set.add(e.recebido_de.trim());
    });
    return Array.from(set).sort();
  });

  readonly blocosDisponiveis = computed(() => {
    const list = this.encomendas();
    const set = new Set<string>();
    list.forEach(e => {
      if (e.destinatario_bloco?.trim()) set.add(e.destinatario_bloco.trim());
    });
    return Array.from(set).sort();
  });

  readonly encomendasFiltradas = computed(() => {
    let list = this.encomendas();
    
    const f = this.filtro();
    if (f) {
      list = list.filter(e => e.status === f);
    }

    const text = this.busca().toLowerCase().trim();
    if (text) {
      list = list.filter(e => 
        e.descricao?.toLowerCase().includes(text) ||
        (e.recebido_de && e.recebido_de.toLowerCase().includes(text)) ||
        e.destinatario_apto?.toLowerCase().includes(text) ||
        (e.destinatario_bloco && e.destinatario_bloco.toLowerCase().includes(text)) ||
        (e.retirado_por && e.retirado_por.toLowerCase().includes(text)) ||
        `#${e.id}`.includes(text)
      );
    }

    const fTransp = this.filtroTransportadora();
    if (fTransp) {
      list = list.filter(e => e.recebido_de?.trim() === fTransp);
    }

    const fBloco = this.filtroBloco();
    if (fBloco) {
      list = list.filter(e => e.destinatario_bloco?.trim() === fBloco);
    }

    return list;
  });

  readonly totalAguardandoFiltradas = computed(() => {
    return this.encomendasFiltradas().filter(e => e.status === 'Aguardando');
  });

  readonly todasSelecionadas = computed(() => {
    const list = this.totalAguardandoFiltradas();
    if (list.length === 0) return false;
    const sel = this.selecionadas();
    return list.every(e => sel.has(e.id));
  });

  readonly aguardando = computed(() => this.encomendas().filter((e) => e.status === 'Aguardando').length);
  readonly retiradas = computed(() => this.encomendas().filter((e) => e.status === 'Retirada').length);

  novo: CreateEncomenda = this.estadoInicial();
  selectedApto: Apartamento | null = null;
  showForm = false;

  ngOnInit() { 
    this.carregar(); 
    this.carregarApartamentos();
    this.route.queryParams.subscribe((params) => {
      if (params['novo'] === 'true') {
        this.showForm = true;
      }
    });
  }

  carregar() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (data) => { 
        this.encomendas.set(data); 
        this.pagina.set(1);
        this.loading.set(false); 
      },
      error: (e) => { this.error.set(e?.message ?? 'Erro'); this.loading.set(false); },
    });
  }

  carregarApartamentos() {
    this.aptosApi.list().subscribe({
      next: (data) => {
        data.sort((a, b) => {
          if (a.bloco === b.bloco) return a.apto.localeCompare(b.apto, 'pt', { numeric: true });
          return (a.bloco ?? '').localeCompare(b.bloco ?? '');
        });
        this.apartamentos.set(data);
      }
    });
  }

  registrar() {
    if (!this.novo.descricao?.trim() || !this.selectedApto) {
      this.error.set('Descrição e apto destinatário são obrigatórios.');
      return;
    }
    
    this.novo.destinatario_bloco = this.selectedApto.bloco || '';
    this.novo.destinatario_apto = this.selectedApto.apto;

    this.api.create(this.novo).subscribe({
      next: () => { 
        this.showForm = false; 
        this.novo = this.estadoInicial(); 
        this.selectedApto = null;
        this.carregar(); 
      },
      error: (e) => this.error.set(e?.message ?? 'Erro'),
    });
  }

  notificar(e: Encomenda) {
    this.loading.set(true);
    this.api.notificar(e.id).subscribe({
      next: () => {
        this.carregar();
      },
      error: (err) => {
        this.error.set(err?.message ?? 'Erro ao notificar morador');
        this.loading.set(false);
      }
    });
  }

  abrirRetirada(e: Encomenda) {
    this.retirandoEncomenda.set(e);
    this.isBatchRetirada = false;
    this.retiranteNome = '';
    this.retiranteDocumento = '';
    this.retiranteParentesco = 'Morador';
  }

  abrirRetiradaLote() {
    if (this.selecionadas().size === 0) return;
    this.retirandoEncomenda.set(null);
    this.isBatchRetirada = true;
    this.retiranteNome = '';
    this.retiranteDocumento = '';
    this.retiranteParentesco = 'Morador';
  }

  confirmarRetirada() {
    if (!this.retiranteNome.trim()) {
      alert('Nome do retirante é obrigatório.');
      return;
    }
    const details = `${this.retiranteNome} (${this.retiranteParentesco}${this.retiranteDocumento ? ' - Doc: ' + this.retiranteDocumento : ''})`;

    this.loading.set(true);
    if (this.isBatchRetirada) {
      const sel = Array.from(this.selecionadas());
      import('rxjs').then(({ forkJoin }) => {
        const requests = sel.map(id => this.api.retirar(id, details));
        forkJoin(requests).subscribe({
          next: () => {
            this.selecionadas.set(new Set());
            this.isBatchRetirada = false;
            this.carregar();
          },
          error: (e) => {
            this.error.set(e?.message ?? 'Erro ao retirar lote');
            this.loading.set(false);
          }
        });
      });
    } else {
      const e = this.retirandoEncomenda();
      if (!e) return;
      this.api.retirar(e.id, details).subscribe({
        next: () => {
          this.retirandoEncomenda.set(null);
          this.carregar();
        },
        error: (err) => {
          this.error.set(err?.message ?? 'Erro ao registrar retirada');
          this.loading.set(false);
        }
      });
    }
  }

  toggleSelecionado(id: number) {
    const current = new Set(this.selecionadas());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.selecionadas.set(current);
  }

  toggleSelecionarTodos() {
    const list = this.totalAguardandoFiltradas();
    const current = new Set(this.selecionadas());
    const allSelected = this.todasSelecionadas();

    if (allSelected) {
      list.forEach(e => current.delete(e.id));
    } else {
      list.forEach(e => current.add(e.id));
    }
    this.selecionadas.set(current);
  }

  notificarLote() {
    const sel = Array.from(this.selecionadas());
    if (sel.length === 0) return;
    
    this.loading.set(true);
    import('rxjs').then(({ forkJoin }) => {
      const requests = sel.map(id => this.api.notificar(id));
      forkJoin(requests).subscribe({
        next: () => {
          this.selecionadas.set(new Set());
          this.carregar();
        },
        error: (e) => {
          this.error.set(e?.message ?? 'Erro ao notificar lote');
          this.loading.set(false);
        }
      });
    });
  }

  limparSelecao() {
    this.selecionadas.set(new Set());
  }

  imprimirLote() {
    const sel = this.selecionadas();
    if (sel.size === 0) return;

    const list = this.encomendas().filter(e => sel.has(e.id));
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) return;

    let htmlContent = `
      <html><head><title>Etiquetas em Lote</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;margin:0}
        .label{border:2px solid #000;padding:16px;border-radius:8px;margin-bottom:20px;page-break-inside:avoid}
        .id{font-size:11px;color:#666;letter-spacing:2px;text-transform:uppercase}
        .apto{font-size:36px;font-weight:bold;margin:8px 0;letter-spacing:-1px}
        .desc{font-size:14px;margin:8px 0;border-top:1px dashed #999;padding-top:8px}
        .meta{font-size:11px;color:#666;margin-top:12px}
      </style></head><body>
    `;

    list.forEach(e => {
      htmlContent += `
        <div class="label">
          <div class="id">Encomenda #${e.id}</div>
          <div class="apto">${e.destinatario_bloco ? e.destinatario_bloco + ' / ' : ''}${e.destinatario_apto}</div>
          <div class="desc">${e.descricao}</div>
          <div class="meta">Recebido de: ${e.recebido_de ?? '—'}<br>Em: ${new Date(e.recebido_em).toLocaleString('pt-BR')}</div>
        </div>
      `;
    });

    htmlContent += `
      <script>window.onload=()=>window.print()</script>
      </body></html>
    `;

    w.document.write(htmlContent);
    w.document.close();
  }

  imprimir(e: Encomenda) {
    const w = window.open('', '_blank', 'width=400,height=300');
    if (!w) return;
    w.document.write(`
      <html><head><title>Etiqueta #${e.id}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;margin:0}
        .label{border:2px solid #000;padding:16px;border-radius:8px}
        .id{font-size:11px;color:#666;letter-spacing:2px;text-transform:uppercase}
        .apto{font-size:48px;font-weight:bold;margin:8px 0;letter-spacing:-1px}
        .desc{font-size:14px;margin:8px 0;border-top:1px dashed #999;padding-top:8px}
        .meta{font-size:11px;color:#666;margin-top:12px}
      </style></head><body>
      <div class="label">
        <div class="id">Encomenda #${e.id}</div>
        <div class="apto">${e.destinatario_bloco ? e.destinatario_bloco + ' / ' : ''}${e.destinatario_apto}</div>
        <div class="desc">${e.descricao}</div>
        <div class="meta">Recebido de: ${e.recebido_de ?? '—'}<br>Em: ${new Date(e.recebido_em).toLocaleString('pt-BR')}</div>
      </div>
      <script>window.onload=()=>window.print()</script>
      </body></html>
    `);
    w.document.close();
  }

  async remover(e: Encomenda) {
    const ok = await this.confirm.ask({
      title: 'Remover encomenda',
      message: `A encomenda "${e.descricao}" será excluída do registro.`,
      confirmLabel: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    this.api.remove(e.id).subscribe({ next: () => this.carregar() });
  }

  diasArmazenada(e: Encomenda): number {
    const recebido = new Date(e.recebido_em).getTime();
    const ref = e.retirado_em ? new Date(e.retirado_em).getTime() : Date.now();
    return Math.floor((ref - recebido) / 86400000);
  }

  private estadoInicial(): CreateEncomenda {
    return { descricao: '', destinatario_apto: '', destinatario_bloco: '', recebido_de: '' };
  }
}
