import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RelatoriosApi } from './relatorios.service';

@Component({
  selector: 'app-relatorios-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './relatorios-page.component.html',
})
export class RelatoriosPageComponent {
  private api = inject(RelatoriosApi);

  readonly activeSubTab = signal<'gerador' | 'auditoria'>('gerador');
  readonly auditLogs = signal<any[]>([]);
  readonly loadingAudit = signal<boolean>(false);
  readonly errorAudit = signal<string | null>(null);

  // Filtros de auditoria
  readonly filtroModulo = signal<string>('todos');
  readonly filtroDataInicio = signal<string>('');
  readonly filtroDataFim = signal<string>('');

  // Gerador de relatórios
  readonly tipo = signal<'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro'>('visitantes');
  readonly dataInicio = signal<string>('');
  readonly dataFim = signal<string>('');
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly modulosDisponiveis = [
    { value: 'todos',        label: 'Todos os módulos' },
    { value: 'visitantes',   label: 'Visitantes' },
    { value: 'encomendas',   label: 'Encomendas' },
    { value: 'moradores',    label: 'Moradores' },
    { value: 'ocorrencias',  label: 'Ocorrências' },
    { value: 'prestadores',  label: 'Prestadores' },
    { value: 'financeiro',   label: 'Financeiro' },
    { value: 'comunicados',  label: 'Comunicados' },
    { value: 'assembleias',  label: 'Assembleias' },
    { value: 'documentos',   label: 'Documentos' },
  ];

  setSubTab(tab: 'gerador' | 'auditoria') {
    this.activeSubTab.set(tab);
    if (tab === 'auditoria') {
      this.carregarAuditoria();
    }
  }

  carregarAuditoria() {
    this.loadingAudit.set(true);
    this.errorAudit.set(null);
    this.api.getAuditoria(
      this.filtroModulo(),
      this.filtroDataInicio() || undefined,
      this.filtroDataFim() || undefined,
    ).subscribe({
      next: (data) => {
        this.auditLogs.set(data || []);
        this.loadingAudit.set(false);
      },
      error: (err) => {
        console.error(err);
        this.errorAudit.set('Falha ao carregar logs de auditoria.');
        this.loadingAudit.set(false);
      },
    });
  }

  aplicarFiltros() {
    this.carregarAuditoria();
  }

  limparFiltros() {
    this.filtroModulo.set('todos');
    this.filtroDataInicio.set('');
    this.filtroDataFim.set('');
    this.carregarAuditoria();
  }

  getAcaoColor(acao: string): string {
    const colors: Record<string, string> = {
      CREATE:    'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
      UPDATE:    'text-blue-400 bg-blue-400/10 border-blue-400/20',
      DELETE:    'text-red-400 bg-red-400/10 border-red-400/20',
      CHECK_IN:  'text-teal-400 bg-teal-400/10 border-teal-400/20',
      CHECK_OUT: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
      RETIRADA:  'text-purple-400 bg-purple-400/10 border-purple-400/20',
      RESPOSTA:  'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
      STATUS:    'text-sky-400 bg-sky-400/10 border-sky-400/20',
    };
    return colors[acao] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20';
  }

  getAcaoLabel(acao: string): string {
    const labels: Record<string, string> = {
      CREATE:    'Criação',
      UPDATE:    'Atualização',
      DELETE:    'Remoção',
      CHECK_IN:  'Check-in',
      CHECK_OUT: 'Check-out',
      RETIRADA:  'Retirada',
      RESPOSTA:  'Resposta',
      STATUS:    'Status',
    };
    return labels[acao] ?? acao;
  }

  getModuloLabel(modulo: string): string {
    const labels: Record<string, string> = {
      visitantes:      'Visitantes',
      encomendas:      'Encomendas',
      moradores:       'Moradores',
      apartamentos:    'Apartamentos',
      ocorrencias:     'Ocorrências',
      comunicados:     'Comunicados',
      prestadores:     'Prestadores',
      financeiro:      'Financeiro',
      assembleias:     'Assembleias',
      documentos:      'Documentos',
      mudancas:        'Mudanças',
      'areas-sociais': 'Áreas Sociais',
      auth:            'Autenticação',
      sistema:         'Sistema',
    };
    return labels[modulo] ?? modulo;
  }

  formatarData(iso: string): string {
    if (!iso) return '-';
    const d = new Date(iso);
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} ${h}:${m}`;
  }

  setTipo(t: 'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro') {
    this.tipo.set(t);
  }

  exportar(formato: 'pdf' | 'xlsx') {
    this.loading.set(true);
    this.error.set(null);

    this.api.downloadReport(
      this.tipo(),
      formato,
      this.dataInicio() || undefined,
      this.dataFim() || undefined,
    ).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const extension = formato;
        const formattedDate = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        a.download = `relatorio_${this.tipo()}_${formattedDate}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.loading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.error.set('Não foi possível gerar o relatório. Verifique os filtros e tente novamente.');
        this.loading.set(false);
      },
    });
  }
}
