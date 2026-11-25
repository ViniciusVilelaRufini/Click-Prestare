import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpResponse } from '@angular/common/http';
import { EventosPeriodo, RelatoriosApi } from './relatorios.service';
import { direcaoLabel as direcaoLabelUtil } from '../shared/direcao-label.util';
import { mascararDocumentoRelatorio, mascararTelefoneRelatorio } from './mascara-relatorios.util';
import { AuthService } from '../auth/auth.service';
import { papelDoToken } from '../auth/papel';

import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';
import { BlocoLabelPipe } from '../shared/bloco-label.pipe';
@Component({
  selector: 'app-relatorios-page',
  standalone: true,
  imports: [CommonModule, FormsModule, SlideIndicatorDirective, BlocoLabelPipe],
  templateUrl: './relatorios-page.component.html',
})
export class RelatoriosPageComponent {
  private api = inject(RelatoriosApi);
  private auth = inject(AuthService);

  /**
   * Mesmo critério da API (isSindicoEstrito): só o síndico lê os módulos
   * sigilosos. Recalcula ao entrar / trocar de condomínio.
   */
  readonly ehSindico = computed(() => {
    this.auth.porteiroInfo();
    return papelDoToken(this.auth.token) === 'sindico';
  });

  readonly activeSubTab = signal<'gerador' | 'auditoria' | 'eventos'>('gerador');
  readonly auditLogs = signal<any[]>([]);
  readonly loadingAudit = signal<boolean>(false);
  readonly errorAudit = signal<string | null>(null);
  readonly exportandoCsv = signal<boolean>(false);
  readonly exportandoCompleto = signal<boolean>(false);

  // Filtros de auditoria
  readonly filtroModulo = signal<string>('todos');
  readonly filtroDataInicio = signal<string>('');
  readonly filtroDataFim = signal<string>('');
  /**
   * O que está valendo na lista. Os inputs acima só mudam a consulta quando o
   * usuário clica em Aplicar (ou Limpar); paginação, Atualizar e Exportar CSV
   * usam este retrato, nunca o que está digitado e ainda não foi aplicado.
   */
  readonly filtrosAuditoriaAplicados = signal<FiltrosAuditoria>({ modulo: 'todos', dataInicio: '', dataFim: '' });

  // Logs de Eventos
  readonly eventLogs = signal<any[]>([]);
  readonly loadingEvents = signal<boolean>(false);
  readonly errorEvents = signal<string | null>(null);
  readonly filtroEventosDataInicio = signal<string>('');
  readonly filtroEventosDataFim = signal<string>('');
  readonly filtroEventosSearch = signal<string>('');
  readonly filtrosEventosAplicados = signal<FiltrosEventos>({ dataInicio: '', dataFim: '', search: '' });
  /** Período inválido (início depois do fim) — a consulta não sai. */
  readonly erroPeriodo = signal<string | null>(null);

  readonly filtroAuditoriaAtivo = computed(() => {
    const f = this.filtrosAuditoriaAplicados();
    return f.modulo !== 'todos' || !!f.dataInicio || !!f.dataFim;
  });
  readonly filtroEventosAtivo = computed(() => {
    const f = this.filtrosEventosAplicados();
    return !!f.dataInicio || !!f.dataFim || !!f.search;
  });
  /** A API cortou o histórico no limite interno: a lista está incompleta. */
  readonly eventosTruncado = signal<boolean>(false);
  /** Período que a API aplicou na última consulta do Log de Eventos. */
  readonly eventosPeriodo = signal<EventosPeriodo | null>(null);
  /** Texto do período padrão — só quando o usuário não escolheu datas. */
  readonly eventosPeriodoPadraoLabel = computed(() => {
    const p = this.eventosPeriodo();
    if (!p?.padrao || !p.dataInicio || !p.dataFim) return null;
    const br = (iso: string) => iso.split('-').reverse().join('/');
    return `Sem período escolhido: exibindo os últimos 30 dias (${br(p.dataInicio)} a ${br(p.dataFim)}).`;
  });

  // Paginação
  readonly pagina = signal<number>(1);
  readonly tamanhoPagina = signal<number>(50);
  readonly total = signal<number>(0);
  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / this.tamanhoPagina())));
  /**
   * `pagina`/`total` são compartilhados pelas abas de auditoria e eventos. Cada
   * consulta (e cada troca de aba) recebe um número; só a resposta da consulta
   * mais recente é aplicada, as demais chegam tarde e são descartadas.
   */
  private consultaAtual = 0;

  // Gerador de relatórios
  readonly tipo = signal<'visitantes' | 'encomendas' | 'ocorrencias' | 'financeiro'>('visitantes');
  readonly dataInicio = signal<string>('');
  readonly dataFim = signal<string>('');
  /** Só no financeiro: reinclui as taxas apto a apto, como o interruptor do Livro Caixa. */
  readonly incluirTaxasCondominiais = signal<boolean>(false);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  private readonly todosModulos: { value: string; label: string }[] = [
    { value: 'todos',         label: 'Todos os módulos' },
    { value: 'facial',        label: 'Controle de Acesso (Dispositivos)' },
    { value: 'regras-acesso', label: 'Regras de Acesso' },
    { value: 'caminhos-acesso', label: 'Caminhos de Acesso' },
    { value: 'guarita',       label: 'Guarita' },
    { value: 'credenciais',   label: 'Credenciais e passes' },
    { value: 'tags',          label: 'Tags de Veículo' },
    { value: 'visitantes',    label: 'Visitantes' },
    { value: 'convites',      label: 'Convites' },
    { value: 'encomendas',    label: 'Encomendas' },
    { value: 'delivery',      label: 'Delivery' },
    { value: 'moradores',     label: 'Moradores' },
    { value: 'apartamentos',  label: 'Apartamentos' },
    { value: 'veiculos',      label: 'Veículos' },
    { value: 'vagas',         label: 'Vagas' },
    { value: 'mudancas',      label: 'Mudanças' },
    { value: 'areas-sociais', label: 'Áreas Sociais' },
    { value: 'ocorrencias',   label: 'Ocorrências' },
    { value: 'prestadores',   label: 'Prestadores' },
    { value: 'funcionarios',  label: 'Funcionários' },
    { value: 'portaria-equipe', label: 'Equipe da portaria' },
    { value: 'portaria-remota', label: 'Portaria remota' },
    { value: 'financeiro',    label: 'Financeiro / Caixa' },
    { value: 'comunicados',   label: 'Comunicados' },
    { value: 'assembleias',   label: 'Assembleias' },
    { value: 'documentos',    label: 'Documentos' },
    { value: 'consentimentos', label: 'Consentimentos (LGPD)' },
    { value: 'condominios',   label: 'Condomínio' },
    { value: 'users',         label: 'Contas de usuário' },
    { value: 'auth',          label: 'Autenticação' },
    { value: 'crm',           label: 'CRM' },
    { value: 'crm-condominio', label: 'CRM do Condomínio' },
    { value: 'crm-morador',   label: 'CRM do Morador' },
    { value: 'superlogica',   label: 'Superlógica' },
    { value: 'relatorios',    label: 'Relatórios' },
    { value: 'auditoria',     label: 'Exportações e auditoria' },
    { value: 'sistema',       label: 'Sistema' },
  ];

  /**
   * Módulos do filtro. Quem não é síndico não vê os que a API esconde dele
   * (MODULOS_AUDITORIA_SIGILOSOS em apps/api/src/app/relatorios/relatorios.service.ts):
   * o filtro voltaria sempre vazio.
   */
  readonly modulosDisponiveis = computed(() =>
    this.ehSindico() ? this.todosModulos : this.todosModulos.filter((m) => !MODULOS_SO_SINDICO.has(m.value)),
  );

  /** Toggle para expandir o JSON de detalhes de cada linha. */
  readonly expandidos = signal<Record<string | number, boolean>>({});

  toggleDetalhes(id: string | number) {
    this.expandidos.update((m) => ({ ...m, [id]: !m[id] }));
  }

  formatarDetalhes(detalhes: string | object | null): string {
    if (!detalhes) return '';
    try {
      const obj = typeof detalhes === 'string' ? JSON.parse(detalhes) : detalhes;
      // Linhas antigas gravavam o PIN/QR do visitante; o valor nunca vai para a tela.
      // CPF/documento/telefone saem mascarados (inclusive no diff { de, para }).
      return JSON.stringify(
        obj,
        (k, v) => {
          if (k === 'codigoAcesso' && v) return '[oculto]';
          return this.valorCampo(k, v);
        },
        2,
      );
    } catch {
      return String(detalhes);
    }
  }

  /** Documento só com os 4 últimos dígitos (formato da API). O que já chegou mascarado fica como está. */
  mascararDocumento(valor: unknown): string {
    return mascararDocumentoRelatorio(valor);
  }

  /** Telefone só com os 4 últimos dígitos (formato da API): (**) *****-8148. */
  mascararTelefone(valor: unknown): string {
    return mascararTelefoneRelatorio(valor);
  }

  /**
   * Valor exibido de um campo de detalhes/diff: mascara quando o nome do campo
   * é de documento ou telefone. Diff `{ de, para }` mascara os dois lados.
   */
  valorCampo(chave: string | number | symbol, valor: any): any {
    const tipo = tipoCampoSensivel(String(chave));
    if (!tipo || valor === null || valor === undefined) return valor;
    const mascara = (v: any) =>
      typeof v === 'string' || typeof v === 'number'
        ? tipo === 'telefone' ? this.mascararTelefone(v) : this.mascararDocumento(v)
        : v;
    if (typeof valor === 'object' && !Array.isArray(valor) && ('de' in valor || 'para' in valor)) {
      return { ...valor, de: mascara(valor.de), para: mascara(valor.para) };
    }
    return mascara(valor);
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

  setSubTab(tab: 'gerador' | 'auditoria' | 'eventos') {
    this.activeSubTab.set(tab);
    // Invalida respostas pendentes da aba anterior e zera o que era dela.
    this.consultaAtual++;
    this.loadingAudit.set(false);
    this.loadingEvents.set(false);
    this.pagina.set(1);
    this.total.set(0);
    this.expandidos.set({});
    this.erroPeriodo.set(null);
    if (tab === 'auditoria') {
      this.carregarAuditoria();
    } else if (tab === 'eventos') {
      this.carregarEventos();
    }
  }

  carregarAuditoria() {
    const consulta = ++this.consultaAtual;
    this.loadingAudit.set(true);
    this.errorAudit.set(null);
    const f = this.filtrosAuditoriaAplicados();
    this.api.getAuditoria(
      f.modulo,
      f.dataInicio || undefined,
      f.dataFim || undefined,
      this.pagina(),
      this.tamanhoPagina(),
    ).subscribe({
      next: (data) => {
        if (consulta !== this.consultaAtual) return;
        if (this.voltarSePassouDoTotal(data?.items ?? [], data?.total ?? 0)) {
          this.carregarAuditoria();
          return;
        }
        this.auditLogs.set(data?.items ?? []);
        this.total.set(data?.total ?? 0);
        this.loadingAudit.set(false);
      },
      error: (err) => {
        if (consulta !== this.consultaAtual) return;
        console.error(err);
        this.errorAudit.set('Falha ao carregar logs de auditoria.');
        this.loadingAudit.set(false);
      },
    });
  }

  carregarEventos() {
    const consulta = ++this.consultaAtual;
    this.loadingEvents.set(true);
    this.errorEvents.set(null);
    const f = this.filtrosEventosAplicados();
    this.api.getEventos(
      f.dataInicio || undefined,
      f.dataFim || undefined,
      this.pagina(),
      this.tamanhoPagina(),
      f.search || undefined,
    ).subscribe({
      next: (data) => {
        if (consulta !== this.consultaAtual) return;
        if (this.voltarSePassouDoTotal(data?.items ?? [], data?.total ?? 0)) {
          this.carregarEventos();
          return;
        }
        this.eventLogs.set(data?.items ?? []);
        this.total.set(data?.total ?? 0);
        this.eventosTruncado.set(data?.truncado === true);
        this.eventosPeriodo.set(data?.periodo ?? null);
        this.loadingEvents.set(false);
      },
      error: (err) => {
        if (consulta !== this.consultaAtual) return;
        console.error(err);
        this.errorEvents.set('Falha ao carregar logs de eventos.');
        this.loadingEvents.set(false);
      },
    });
  }

  /**
   * A página pedida passou do total (registros sumiram entre uma consulta e
   * outra, ex.: depois de Atualizar). Volta para a última página válida e
   * devolve true para a consulta ser refeita.
   */
  private voltarSePassouDoTotal(items: unknown[], total: number): boolean {
    if (items.length > 0 || total <= 0 || this.pagina() <= 1) return false;
    const ultima = Math.max(1, Math.ceil(total / this.tamanhoPagina()));
    if (this.pagina() <= ultima) return false;
    this.pagina.set(ultima);
    return true;
  }

  private periodoInvalido(inicio: string, fim: string): boolean {
    // `AAAA-MM-DD` compara certo como texto.
    return !!inicio && !!fim && inicio > fim;
  }

  aplicarFiltros() {
    const aba = this.activeSubTab();
    if (aba === 'auditoria') {
      if (this.periodoInvalido(this.filtroDataInicio(), this.filtroDataFim())) {
        this.erroPeriodo.set(MSG_PERIODO_INVALIDO);
        return;
      }
      this.filtrosAuditoriaAplicados.set({
        modulo: this.filtroModulo(),
        dataInicio: this.filtroDataInicio(),
        dataFim: this.filtroDataFim(),
      });
    } else if (aba === 'eventos') {
      if (this.periodoInvalido(this.filtroEventosDataInicio(), this.filtroEventosDataFim())) {
        this.erroPeriodo.set(MSG_PERIODO_INVALIDO);
        return;
      }
      this.filtrosEventosAplicados.set({
        dataInicio: this.filtroEventosDataInicio(),
        dataFim: this.filtroEventosDataFim(),
        search: this.filtroEventosSearch().trim(),
      });
    } else {
      return;
    }
    this.erroPeriodo.set(null);
    this.pagina.set(1);
    if (aba === 'auditoria') this.carregarAuditoria();
    else this.carregarEventos();
  }

  limparFiltros() {
    this.pagina.set(1);
    this.erroPeriodo.set(null);
    if (this.activeSubTab() === 'auditoria') {
      this.filtroModulo.set('todos');
      this.filtroDataInicio.set('');
      this.filtroDataFim.set('');
      this.filtrosAuditoriaAplicados.set({ modulo: 'todos', dataInicio: '', dataFim: '' });
      this.carregarAuditoria();
    } else if (this.activeSubTab() === 'eventos') {
      this.filtroEventosDataInicio.set('');
      this.filtroEventosDataFim.set('');
      this.filtroEventosSearch.set('');
      this.filtrosEventosAplicados.set({ dataInicio: '', dataFim: '', search: '' });
      this.carregarEventos();
    }
  }

  irParaPagina(p: number) {
    if (p < 1 || p > this.totalPaginas()) return;
    this.pagina.set(p);
    if (this.activeSubTab() === 'auditoria') {
      this.carregarAuditoria();
    } else if (this.activeSubTab() === 'eventos') {
      this.carregarEventos();
    }
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
    if (this.activeSubTab() === 'auditoria') {
      this.carregarAuditoria();
    } else if (this.activeSubTab() === 'eventos') {
      this.carregarEventos();
    }
  }

  exportarCsv() {
    this.exportandoCsv.set(true);
    const f = this.filtrosAuditoriaAplicados();
    this.api.exportAuditoria(
      f.modulo,
      f.dataInicio || undefined,
      f.dataFim || undefined,
    ).subscribe({
      next: (resp) => {
        this.baixarResposta(resp, `auditoria_${dataHojeSaoPaulo()}.csv`);
        this.exportandoCsv.set(false);
      },
      error: (err) => {
        console.error(err);
        this.errorAudit.set(
          err?.status === 403
            ? 'A exportação do log de auditoria é exclusiva do síndico.'
            : 'Falha ao exportar CSV.',
        );
        this.exportandoCsv.set(false);
      },
    });
  }

  exportarDadosCompletos() {
    this.exportandoCompleto.set(true);
    this.error.set(null);
    this.api.exportDadosCompletos().subscribe({
      next: (resp) => {
        this.baixarResposta(resp, `export_condominio_${dataHojeSaoPaulo()}.zip`);
        this.exportandoCompleto.set(false);
      },
      error: (err) => {
        console.error(err);
        // O botão fica na aba Relatórios Gerais, que mostra error() — não errorAudit().
        this.error.set(
          err?.status === 403
            ? 'A exportação completa dos dados é exclusiva do síndico.'
            : 'Falha ao exportar dados completos.',
        );
        this.exportandoCompleto.set(false);
      },
    });
  }

  /** Nome do servidor (Content-Disposition) quando vem; senão o padrão com a data de Brasília. */
  private baixarResposta(resp: HttpResponse<Blob> | Blob, padrao: string) {
    const blob = resp instanceof HttpResponse ? resp.body : resp;
    if (!blob) return;
    const nome =
      resp instanceof HttpResponse ? nomeDoContentDisposition(resp.headers.get('Content-Disposition')) : null;
    this.baixarArquivo(blob, nome || padrao);
  }

  private baixarArquivo(blob: Blob, nome: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
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
      ENTREGA:          'text-purple-400 bg-purple-400/10 border-purple-400/20',
      ONLINE:           'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
      OFFLINE:          'text-red-400 bg-red-400/10 border-red-400/20',
      FANTASMAS_REMOVIDOS:        'text-orange-400 bg-orange-400/10 border-orange-400/20',
      DISPOSITIVO_IP_CORRIGIDO:   'text-indigo-300 bg-indigo-500/15 border-indigo-500/30',
      DISPOSITIVO_MAC_ATUALIZADO: 'text-indigo-300 bg-indigo-500/15 border-indigo-500/30',
      DEACTIVATE:       'text-orange-400 bg-orange-400/10 border-orange-400/20',
      REACTIVATE:       'text-teal-400 bg-teal-400/10 border-teal-400/20',
      EXECUTE:          'text-cyan-300 bg-cyan-500/15 border-cyan-500/30',
      EXPORT:           'text-amber-300 bg-amber-500/15 border-amber-500/30',
      LOGIN:            'text-sky-400 bg-sky-400/10 border-sky-400/20',
      LOGIN_FALHA:     'text-red-300 bg-red-500/15 border-red-500/30',
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
      ENTREGA:          'Entrega',
      ONLINE:           'Dispositivo online',
      OFFLINE:          'Dispositivo offline',
      FANTASMAS_REMOVIDOS:        'Rostos órfãos removidos',
      DISPOSITIVO_IP_CORRIGIDO:   'IP do dispositivo corrigido',
      DISPOSITIVO_MAC_ATUALIZADO: 'MAC do dispositivo atualizado',
      DEACTIVATE:       'Desativação',
      REACTIVATE:       'Reativação',
      EXECUTE:          'Execução',
      EXPORT:           'Exportação de dados',
      LOGIN:            'Login',
      LOGIN_FALHA:     'Tentativa de login',
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
      dispositivos:    'Dispositivos de Acesso',
      'facial-health': 'Monitoramento dos Dispositivos',
      visitas:         'Visitas',
      pessoas:         'Cadastro de Pessoas',
      'caminhos-acesso': 'Caminhos de Acesso',
      condominios:     'Condomínio',
      crm:             'CRM',
      'crm-condominio': 'CRM do Condomínio',
      superlogica:     'Superlógica',
      veiculos:        'Veículos',
      vagas:           'Vagas',
      funcionarios:    'Funcionários',
      convites:        'Convites',
      delivery:        'Delivery',
      users:           'Contas de usuário',
      auditoria:       'Exportações e auditoria',
      tags:            'Tags de Veículo',
      consentimentos:  'Consentimentos (LGPD)',
      sindico:         'Síndico',
      agenda:          'Agenda',
      contatos:        'Contatos',
      notificacoes:    'Notificações',
      'chat-ia':       'Assistente IA',
      dashboard:       'Dashboard',
      relatorios:      'Relatórios',
      guarita:         'Guarita',
      credenciais:     'Credenciais e passes',
      wallet:          'Credenciais e passes',
      'portaria-equipe': 'Equipe da portaria',
      'portaria-remota': 'Portaria remota',
      'crm-morador':   'CRM do Morador',
    };
    // A API grava alguns módulos em maiúsculas (ex.: AUTH).
    return labels[(modulo ?? '').toLowerCase()] ?? modulo;
  }

  /** Data e hora de Brasília, qualquer que seja o fuso do PC (o da portaria costuma estar errado). */
  formatarData(iso: string): string {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d
      .toLocaleString('pt-BR', {
        timeZone: FUSO,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(',', '');
  }

  /**
   * Selo (badge) da coluna "Direção" do log de eventos. Lógica compartilhada
   * com o Dashboard em shared/direcao-label.util.ts: eventos reais de acesso
   * de pessoas mostram Entrada/Saída/Bloqueado; eventos de status de
   * dispositivo (relatorios.service.ts#getEventos, AuditLog "dispositivos")
   * têm selo próprio Offline/Online — não são entrada/saída de ninguém.
   */
  direcaoLabel(direcao: string | undefined, tipo: string): string {
    return direcaoLabelUtil(direcao, tipo);
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
      this.tipo() === 'financeiro' && this.incluirTaxasCondominiais(),
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
        this.loading.set(false);
        const padrao = 'Não foi possível gerar o relatório. Verifique os filtros e tente novamente.';
        // O download pede blob: a mensagem da API (403, 400...) chega dentro dele.
        const corpo = err?.error;
        if (corpo instanceof Blob) {
          this.error.set(padrao);
          void mensagemDoBlob(corpo).then((msg) => {
            if (msg) this.error.set(msg);
          });
        } else {
          this.error.set(err?.error?.message ?? padrao);
        }
      },
    });
  }
}

interface FiltrosAuditoria {
  modulo: string;
  dataInicio: string;
  dataFim: string;
}

interface FiltrosEventos {
  dataInicio: string;
  dataFim: string;
  search: string;
}

const FUSO = 'America/Sao_Paulo';
const MSG_PERIODO_INVALIDO = 'A data de início não pode ser depois da data de fim.';

/** Espelha MODULOS_AUDITORIA_SIGILOSOS da API (apps/api/src/app/relatorios/relatorios.service.ts). */
const MODULOS_SO_SINDICO = new Set(['financeiro', 'crm', 'crm-condominio', 'superlogica', 'auth']);

const CAMPOS_DOCUMENTO = new Set(['cpf', 'cnpj', 'rg', 'doc', 'documento', 'doc_identificacao', 'cpf_cnpj', 'documento_identificacao']);

function tipoCampoSensivel(chave: string): 'documento' | 'telefone' | null {
  const k = (chave ?? '').toLowerCase();
  if (!k) return null;
  if (CAMPOS_DOCUMENTO.has(k) || k.includes('cpf') || k.includes('documento')) return 'documento';
  if (k.includes('telefone') || k.includes('celular') || k.includes('whatsapp') || k === 'fone' || k === 'phone') return 'telefone';
  return null;
}

/** `AAAA-MM-DD` de hoje em Brasília (toISOString vira o dia às 21h). */
export function dataHojeSaoPaulo(agora: Date = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: FUSO });
}

/** `filename` (ou `filename*` RFC 5987) do Content-Disposition; null quando não há. */
export function nomeDoContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  const estendido = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i.exec(header);
  if (estendido) {
    try {
      return decodeURIComponent(estendido[1].trim().replace(/^"|"$/g, '')) || null;
    } catch {
      /* cai no filename simples */
    }
  }
  const simples = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const nome = (simples?.[2] ?? simples?.[1] ?? '').trim();
  // Só o nome: nada de caminho vindo do header.
  return nome ? nome.split(/[\\/]/).pop() || null : null;
}

/** `message` do JSON de erro da API que veio como Blob (download); null se não houver. */
export async function mensagemDoBlob(blob: Blob): Promise<string | null> {
  try {
    const texto =
      typeof blob.text === 'function'
        ? await blob.text()
        : await new Promise<string>((ok, falha) => {
            const leitor = new FileReader();
            leitor.onload = () => ok(String(leitor.result ?? ''));
            leitor.onerror = () => falha(leitor.error);
            leitor.readAsText(blob);
          });
    const msg = JSON.parse(texto)?.message;
    if (!msg) return null;
    return Array.isArray(msg) ? msg.join(' ') : String(msg);
  } catch {
    return null; // corpo não é JSON
  }
}
