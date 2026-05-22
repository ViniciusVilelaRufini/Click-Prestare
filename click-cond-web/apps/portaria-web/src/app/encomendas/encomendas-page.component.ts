import { Component, OnInit, computed, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

  constructor() {
    effect(() => {
      this.filtro();
      this.busca();
      this.filtroTransportadora();
      this.filtroBloco();
      untracked(() => {
        this.pagina.set(1);
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
    
    // 1. Status
    const f = this.filtro();
    if (f) {
      list = list.filter(e => e.status === f);
    }

    // 2. Busca
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

    // 3. Transportadora
    const fTransp = this.filtroTransportadora();
    if (fTransp) {
      list = list.filter(e => e.recebido_de?.trim() === fTransp);
    }

    // 4. Bloco
    const fBloco = this.filtroBloco();
    if (fBloco) {
      list = list.filter(e => e.destinatario_bloco?.trim() === fBloco);
    }

    return list;
  });

  readonly aguardando = computed(() => this.encomendas().filter((e) => e.status === 'Aguardando').length);
  readonly retiradas = computed(() => this.encomendas().filter((e) => e.status === 'Retirada').length);

  novo: CreateEncomenda = this.estadoInicial();
  selectedApto: Apartamento | null = null;
  showForm = false;

  ngOnInit() { 
    this.carregar(); 
    this.carregarApartamentos();
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
        // Ordenar os apartamentos para ficar bonitinho
        data.sort((a, b) => {
          if (a.bloco === b.bloco) return a.apto.localeCompare(b.apto);
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

  retirar(e: Encomenda) {
    const por = prompt(`Quem está retirando "${e.descricao}"?\nNome do morador:`);
    if (!por) return;
    this.api.retirar(e.id, por).subscribe({ next: () => this.carregar() });
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
