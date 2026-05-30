import { Component, computed, inject, signal } from '@angular/core';
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
  readonly exportandoCsv = signal<boolean>(false);

  // Filtros de auditoria
  readonly filtroModulo = signal<string>('todos');
  readonly filtroDataInicio = signal<string>('');
  readonly filtroDataFim = signal<string>('');

  // Paginação
  readonly pagina = signal<number>(1);
  readonly tamanhoPagina = signal<number>(50);
  readonly total = signal<number>(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / this.tamanhoPagina())));

  // Gerador de relatórios
  readonly tipo = signal<'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro'>('visitantes');
  readonly dataInicio = signal<string>('');
  readonly dataFim = signal<string>('');
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly modulosDisponiveis = [
    { value: 'todos',         label: 'Todos os módulos' },
    { value: 'facial',        label: 'Controle de Acesso (Dispositivos)' },
    { value: 'regras-acesso', label: 'Regras de Acesso' },
    { value: 'visitantes',    label: 'Visitantes' },
    { value: 'encomendas',    label: 'Encomendas' },
    { value: 'moradores',     label: 'Moradores' },
    { value: 'ocorrencias',   label: 'Ocorrências' },
    { value: 'prestadores',   label: 'Prestadores' },
    { value: 'financeiro',    label: 'Financeiro / Caixa' },
    { value: 'comunicados',   label: 'Comunicados' },
    { value: 'assembleias',   label: 'Assembleias' },
    { value: 'documentos',    label: 'Documentos' },
  ];

  /** Toggle para expandir o JSON de detalhes de cada linha. */
  readonly expandidos = signal<Record<number, boolean>>({});

  toggleDetalhes(id: number) {
    this.expandidos.update((m) => ({ ...m, [id]: !m[id] }));
  }

  formatarDetalhes(detalhes: string | object | null): string {
    if (!detalhes) return '';
    try {
      const obj = typeof detalhes === 'string' ? JSON.parse(detalhes) : detalhes;
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(detalhes);
    }
  }

  /** Verifica se um objeto de diff tem pelo menos uma chave (usado no template). */
  temChanges(changes: any): boolean {
    return !!changes && typeof changes === 'object' && Object.keys(changes).length > 0;
  }

  /** Parsing tipado do `detalhes` para renderização rica no template. */
  parseDetalhes(detalhes: string | object | null): any {
    if (!detalhes) return null;
    try {
      return typeof detalhes === 'string' ? JSON.parse(detalhes) : detalhes;
    } catch {
      return null;
    }
  }

  /**
   * Reconhece o "schema" do detalhes pra escolher o card certo.
   * Mais tipos podem ser adicionados conforme outros serviços enriquecem.
   */
  tipoDetalhes(
    detalhes: any,
  ): 'visitante' | 'encomenda' | 'morador' | 'morador-update'
    | 'comunicado' | 'comunicado-update'
    | 'financeiro' | 'financeiro-update' | 'rateio' | 'acordo' | 'conciliacao'
    | 'device-change' | 'rule-change' | 'manual-override' | 'generico' {
    if (!detalhes) return 'generico';
    if (detalhes.visitante && detalhes.apartamento !== undefined) return 'visitante';
    if (detalhes.encomenda && detalhes.destinatario !== undefined) return 'encomenda';
    // Updates gravam { contexto, changes } — detectados antes do change-only
    if (detalhes.contexto?.morador && detalhes.changes) return 'morador-update';
    if (detalhes.contexto?.comunicado && detalhes.changes) return 'comunicado-update';
    if (detalhes.contexto?.lancamento && detalhes.changes) return 'financeiro-update';
    if (detalhes.morador && detalhes.credenciais !== undefined) return 'morador';
    if (detalhes.comunicado && detalhes.publicado !== undefined) return 'comunicado';
    if (detalhes.lancamento && detalhes.datas !== undefined) return 'financeiro';
    if (detalhes.rateio) return 'rateio';
    if (detalhes.acordo) return 'acordo';
    if (detalhes.conciliacao) return 'conciliacao';
    if (detalhes.device_nome && detalhes.success !== undefined) return 'manual-override';
    if (detalhes.changes && typeof detalhes.changes === 'object') {
      // Distingue device de rule pelos campos no diff
      const keys = Object.keys(detalhes.changes);
      const deviceKeys = ['nome', 'tipo', 'ip', 'porta', 'fabricante', 'api_user', 'api_password'];
      if (keys.some((k) => deviceKeys.includes(k))) return 'device-change';
      return 'rule-change';
    }
    return 'generico';
  }

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
      this.pagina(),
      this.tamanhoPagina(),
    ).subscribe({
      next: (data) => {
        this.auditLogs.set(data?.items ?? []);
        this.total.set(data?.total ?? 0);
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
    // Mudou filtro: volta para a página 1.
    this.pagina.set(1);
    this.carregarAuditoria();
  }

  limparFiltros() {
    this.filtroModulo.set('todos');
    this.filtroDataInicio.set('');
    this.filtroDataFim.set('');
    this.pagina.set(1);
    this.carregarAuditoria();
  }

  irParaPagina(p: number) {
    if (p < 1 || p > this.totalPaginas()) return;
    this.pagina.set(p);
    this.carregarAuditoria();
  }

  proximaPagina() {
    this.irParaPagina(this.pagina() + 1);
  }

  paginaAnterior() {
    this.irParaPagina(this.pagina() - 1);
  }

  mudarTamanhoPagina(novo: number) {
    this.tamanhoPagina.set(novo);
    this.pagina.set(1);
    this.carregarAuditoria();
  }

  exportarCsv() {
    this.exportandoCsv.set(true);
    this.api.exportAuditoria(
      this.filtroModulo(),
      this.filtroDataInicio() || undefined,
      this.filtroDataFim() || undefined,
    ).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `auditoria_${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        this.exportandoCsv.set(false);
      },
      error: (err) => {
        console.error(err);
        this.errorAudit.set('Falha ao exportar CSV.');
        this.exportandoCsv.set(false);
      },
    });
  }

  getAcaoColor(acao: string): string {
    const colors: Record<string, string> = {
      CREATE:           'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
      UPDATE:           'text-blue-400 bg-blue-400/10 border-blue-400/20',
      DELETE:           'text-red-400 bg-red-400/10 border-red-400/20',
      CHECK_IN:         'text-teal-400 bg-teal-400/10 border-teal-400/20',
      CHECK_OUT:        'text-orange-400 bg-orange-400/10 border-orange-400/20',
      RETIRADA:         'text-purple-400 bg-purple-400/10 border-purple-400/20',
      RESPOSTA:         'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
      STATUS:           'text-sky-400 bg-sky-400/10 border-sky-400/20',
      // Decisões de controle de acesso físico — visualmente fortes
      ACCESS_GRANTED:   'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
      ACCESS_DENIED:    'text-red-300 bg-red-500/15 border-red-500/30',
      MANUAL_OVERRIDE:  'text-amber-300 bg-amber-500/15 border-amber-500/30',
      BRIDGE_TRIGGER:   'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
      RULE_CHANGE:      'text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-500/30',
      DEVICE_CHANGE:    'text-indigo-300 bg-indigo-500/15 border-indigo-500/30',
    };
    return colors[acao] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20';
  }

  getAcaoLabel(acao: string): string {
    const labels: Record<string, string> = {
      CREATE:           'Criação',
      UPDATE:           'Atualização',
      DELETE:           'Remoção',
      CHECK_IN:         'Check-in',
      CHECK_OUT:        'Check-out',
      RETIRADA:         'Retirada',
      RESPOSTA:         'Resposta',
      STATUS:           'Status',
      ACCESS_GRANTED:   'Acesso liberado',
      ACCESS_DENIED:    'Acesso negado',
      MANUAL_OVERRIDE:  'Acionamento manual',
      BRIDGE_TRIGGER:   'Acionamento automático',
      RULE_CHANGE:      'Mudança de regra',
      DEVICE_CHANGE:    'Mudança de dispositivo',
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
      facial:          'Controle de Acesso',
      'regras-acesso': 'Regras de Acesso',
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
