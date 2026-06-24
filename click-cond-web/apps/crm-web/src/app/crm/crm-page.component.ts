import { Component, HostListener, OnInit, OnDestroy, ViewChild, ElementRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CrmApi, CrmCliente, CrmHealth, CrmOverview, EstagioCrm, StatusPagamento } from './crm.service';
import { AuthService } from '../auth/auth.service';
import { CountUpDirective } from '../shared/count-up.directive';

type StatusFatura = 'todos' | 'paga' | 'pendente' | 'vencida';

type EstagioFiltro = 'todos' | EstagioCrm;
type Ordenacao = 'mrr' | 'health' | 'nome' | 'vencimento';

@Component({
  selector: 'app-crm-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CountUpDirective],
  templateUrl: './crm-page.component.html',
})
export class CrmPageComponent implements OnInit, OnDestroy {
  private api = inject(CrmApi);
  readonly auth = inject(AuthService);
  private healthInterval: any = null;

  readonly overview = signal<CrmOverview | null>(null);
  readonly clientes = signal<CrmCliente[]>([]);
  readonly loading = signal(true);
  readonly erro = signal<string | null>(null);

  readonly busca = signal('');          // termo aplicado ao filtro (debounced)
  readonly buscaRaw = signal('');       // valor imediato do input
  private buscaTimer: any = null;
  readonly filtroEstagio = signal<EstagioFiltro>('todos');
  readonly ordenacao = signal<Ordenacao>('mrr');
  readonly clienteSelecionado = signal<CrmCliente | null>(null);
  readonly abaSelecionada = signal<'geral' | 'portaria' | 'servicos'>('geral');
  readonly Math = Math;

  readonly modoEdicao = signal(false);
  readonly salvando = signal(false);
  dadosEditados: any = {};

  // --- Status de conexão com banco de dados ---
  readonly dbHealth = signal<CrmHealth | null>(null);
  readonly healthLoading = signal(false);

  // --- Filtro de faturas ---
  readonly filtroFatura = signal<StatusFatura>('todos');
  // Linha recém-liquidada (para flash de sucesso)
  readonly ultimaFaturaPaga = signal<string | null>(null);

  // --- Estado de Navegação CRM ---
  readonly abaNavegacao = signal<'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes'>('overview');

  // --- Mock Faturamento & Faturas ---
  readonly faturas = signal([
    { id: 'FT-2026-482', clienteId: 1, condominio: 'Condomínio Residencial Vista Bella', valor: 450, vencimento: '2026-06-15', metodoPagamento: 'Pix', status: 'paga', dataPagamento: '2026-06-15T14:23:00Z' },
    { id: 'FT-2026-483', clienteId: 2, condominio: 'Condomínio Spazio Di Sol', valor: 650, vencimento: '2026-06-20', metodoPagamento: 'Boleto', status: 'paga', dataPagamento: '2026-06-20T09:12:00Z' },
    { id: 'FT-2026-484', clienteId: 3, condominio: 'Residencial Plaza de las Flores', valor: 250, vencimento: '2026-06-10', metodoPagamento: 'Pix', status: 'vencida', dataPagamento: null },
    { id: 'FT-2026-485', clienteId: 4, condominio: 'Condomínio Solar das Amendoeiras', valor: 450, vencimento: '2026-06-24', metodoPagamento: 'Pix', status: 'pendente', dataPagamento: null },
    { id: 'FT-2026-486', clienteId: 5, condominio: 'Residencial Jardim das Palmeiras', valor: 850, vencimento: '2026-06-28', metodoPagamento: 'Cartão', status: 'pendente', dataPagamento: null },
    { id: 'FT-2026-487', clienteId: 3, condominio: 'Residencial Plaza de las Flores', valor: 250, vencimento: '2026-05-10', metodoPagamento: 'Boleto', status: 'vencida', dataPagamento: null }
  ]);

  // --- Mock Automações & Régua de WhatsApp ---
  readonly configAutomacoes = signal({
    triggerPreVencimento: true,
    diasPreVencimento: 5,
    templatePreVencimento: 'Olá, *{{sindico}}*!\nLembramos que a fatura do *{{condominio}}* referente ao plano *{{plano}}* vencerá em {{dias}} dias ({{vencimento}}).\n\nValor: *{{valor}}*\nCódigo Copia/Cola Pix: `{{copia_cola}}`\n\nLink para segunda via: {{link_pagamento}}',
    
    triggerVencimento: true,
    templateVencimento: 'Olá, *{{sindico}}*!\nSua fatura do *{{condominio}}* vence hoje.\n\nValor: *{{valor}}*\nCódigo Copia/Cola Pix: `{{copia_cola}}`\n\nLink para segunda via: {{link_pagamento}}',
    
    triggerPosVencimento: true,
    diasPosVencimento: 3,
    templatePosVencimento: 'ATENÇÃO: Olá, *{{sindico}}*.\nIdentificamos pendência financeira na assinatura do *{{condominio}}* vencida há {{dias}} dias ({{vencimento}}).\n\nValor original: *{{valor}}*\n\nEvite a suspensão dos serviços e atualização de hardware. Efetue o pagamento através do link: {{link_pagamento}}'
  });

  readonly historicoDisparos = signal([
    { data: '2026-06-23T10:15:00Z', condominio: 'Condomínio Spazio Di Sol', tipo: 'Dia do vencimento', status: 'entregue', telefone: '(11) 98112-9988', erroMsg: null },
    { data: '2026-06-23T08:30:00Z', condominio: 'Residencial Plaza de las Flores', tipo: 'Cobrança atrasada', status: 'entregue', telefone: '(11) 97722-1144', erroMsg: null },
    { data: '2026-06-22T14:45:00Z', condominio: 'Condomínio Residencial Vista Bella', tipo: 'Aviso prévio', status: 'entregue', telefone: '(11) 98988-5522', erroMsg: null },
    { data: '2026-06-21T09:00:00Z', condominio: 'Residencial Jardim das Palmeiras', tipo: 'Dia do vencimento', status: 'falhou', telefone: '(11) 99122-3344', erroMsg: 'Dispositivo desconectado no gateway' }
  ]);

  // --- Mock Configuração de Planos Click Prestare ---
  readonly configPlanos = signal([
    { plano: 'Essencial', sistema: 'Somente App', valorBase: 149, valorPorUH: 2.00 },
    { plano: 'Profissional', sistema: 'Com Portaria', valorBase: 297, valorPorUH: 2.80 },
    { plano: 'Elite', sistema: 'Com Controle de Acesso', valorBase: 497, valorPorUH: 3.80 }
  ]);

  // --- Mock Credenciais de Gateways ---
  readonly gateways = signal({
    asaasApiKey: 'prod_asaas_8b5cf606b6d410b9816b7280f2d5a3ef943312c488b5cf606b',
    asaasWebhookSecret: 'whsec_93310337508751050',
    zapiInstanceId: 'inst_312015096010201100',
    zapiToken: 'zapi_tok_f4007a1b3c9d2e4f6a8b0c'
  });

  // --- Mock Logs Técnicos e Webhooks ---
  readonly logsWebhooks = signal([
    { data: '2026-06-24T00:12:00Z', origem: 'Asaas', evento: 'payment_received', status: 'sucesso', payload: '{"paymentId":"pay_4839201","value":450.00,"condominioId":1,"method":"Pix"}' },
    { data: '2026-06-23T23:45:00Z', origem: 'Z-API', evento: 'message_sent', status: 'sucesso', payload: '{"messageId":"msg_8820491","to":"5511981129988","status":"delivered"}' },
    { data: '2026-06-23T18:22:00Z', origem: 'Asaas', evento: 'webhook_validated', status: 'sucesso', payload: '{"verification":"ok","gateway_status":"healthy"}' },
    { data: '2026-06-23T14:30:00Z', origem: 'System', evento: 'config_updated', status: 'info', payload: '{"updatedBy":"admin@clickprestare.com.br","section":"automacoes"}' }
  ]);

  // --- Preview de template em tempo real (Automações) ---
  readonly previewTemplate = signal<'pre' | 'venc' | 'pos'>('pre');

  private readonly previewSampleData: Record<string, string> = {
    sindico: 'Vinícius Síndico',
    condominio: 'Condomínio Vista Bella',
    plano: 'Profissional',
    valor: 'R$ 450,00',
    vencimento: '30/06/2026',
    dias: '5',
    copia_cola: '00020126360014br.gov.bcb.pix0114+5511999998888',
    link_pagamento: 'clickprestare.com.br/faturas/1',
  };

  // Método (não computed): os textareas mutam o objeto in-place, então
  // precisa reavaliar a cada ciclo de detecção de mudanças (zone-based).
  previewMensagemHtml(): string {
    const cfg = this.configAutomacoes();
    const sel = this.previewTemplate();
    const tpl =
      sel === 'pre' ? cfg.templatePreVencimento
      : sel === 'venc' ? cfg.templateVencimento
      : cfg.templatePosVencimento;

    const data = { ...this.previewSampleData };
    if (sel === 'pre') data['dias'] = String(cfg.diasPreVencimento);
    if (sel === 'pos') data['dias'] = String(cfg.diasPosVencimento);

    // 1) substitui variáveis  2) escapa HTML  3) aplica markdown do WhatsApp
    const substituido = (tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
      data[k] !== undefined ? data[k] : m,
    );
    const escapado = substituido
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escapado
      .replace(/\*([^*]+)\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code class="bg-white/[0.06] px-1 rounded text-accent-300">$1</code>')
      .replace(/_([^_]+)_/g, '<i>$1</i>');
  }

  readonly previewTabs: { valor: 'pre' | 'venc' | 'pos'; label: string }[] = [
    { valor: 'pre', label: 'Aviso prévio' },
    { valor: 'venc', label: 'No vencimento' },
    { valor: 'pos', label: 'Atraso' },
  ];

  // Disparo recém-registrado (para highlight na lista)
  readonly ultimoDisparoData = signal<string | null>(null);

  // Visibilidade das chaves de API (show/hide) + log recém-registrado
  readonly chavesVisiveis = signal<Record<string, boolean>>({});
  readonly ultimoLogData = signal<string | null>(null);

  toggleChave(k: string): void {
    this.chavesVisiveis.update((s) => ({ ...s, [k]: !s[k] }));
  }

  copiarTexto(texto: string, label: string): void {
    const ok = () => this.triggerToast(`${label} copiado para a área de transferência.`, 'success');
    const fail = () => this.triggerToast('Não foi possível copiar para a área de transferência.', 'error');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(texto).then(ok, fail);
    } else {
      fail();
    }
  }

  private pushLog(entry: { data: string; origem: string; evento: string; status: string; payload: string }): void {
    this.ultimoLogData.set(entry.data);
    setTimeout(() => {
      if (this.ultimoLogData() === entry.data) this.ultimoLogData.set(null);
    }, 1800);
    this.logsWebhooks.update((log) => [entry, ...log]);
  }

  // Estados de feedback visual
  readonly salvandoRegua = signal(false);
  readonly salvandoConfigPlanos = signal(false);
  readonly salvandoGateways = signal(false);

  // Fila de toasts empilháveis com variantes (success/error/info)
  readonly toasts = signal<{ id: number; message: string; tipo: 'success' | 'error' | 'info' }[]>([]);
  private toastSeq = 0;

  // Mock dados históricos para o gráfico de área de MRR (12 meses)
  readonly historicoReceita = signal([
    { mes: 'Jul 25', valor: 2800 },
    { mes: 'Ago 25', valor: 3100 },
    { mes: 'Set 25', valor: 3000 },
    { mes: 'Out 25', valor: 3500 },
    { mes: 'Nov 25', valor: 4200 },
    { mes: 'Dez 25', valor: 4000 },
    { mes: 'Jan 26', valor: 4800 },
    { mes: 'Fev 26', valor: 5100 },
    { mes: 'Mar 26', valor: 5500 },
    { mes: 'Abr 26', valor: 5300 },
    { mes: 'Mai 26', valor: 6200 },
    { mes: 'Jun 26', valor: 6800 }
  ]);

  // Sparklines para os 4 cards principais de KPIs
  readonly sparklines = computed(() => {
    return {
      mrr: this.sparklinePath([2800, 3100, 3000, 3500, 4200, 4000, 4800, 5100, 5500, 5300, 6200, 6800], 120, 36),
      clientes: this.sparklinePath([3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5], 120, 36),
      inadimplencia: this.sparklinePath([1, 1, 2, 1, 0, 1, 2, 1, 1, 1, 1, 1], 120, 36),
      ticket: this.sparklinePath([933, 1033, 750, 875, 1050, 800, 960, 1020, 1100, 1060, 1240, 1360], 120, 36)
    };
  });

  readonly pathHistorico = computed(() => {
    const dados = this.historicoReceita();
    const values = dados.map(d => d.valor);
    const maxVal = Math.max(...values) * 1.1;
    const minVal = Math.min(...values) * 0.9;
    const range = maxVal - minVal;
    
    const width = 600;
    const height = 150;
    
    const points = dados.map((d, index) => {
      const x = (index / (dados.length - 1)) * width;
      const y = height - 10 - ((d.valor - minVal) / range) * (height - 20);
      return { x, y };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

    return { linePath, areaPath, points };
  });

  readonly planosDoughnut = computed(() => {
    const ov = this.overview();
    if (!ov) return [];
    
    const total = ov.clientesAtivos || 1;
    let acumulado = 0;
    const raio = 40;
    const circ = 2 * Math.PI * raio; // ~251.32

    return ov.porPlano.map((p, idx) => {
      const pct = p.clientes / total;
      const strokeLength = pct * circ;
      const strokeOffset = circ + acumulado;
      acumulado -= strokeLength;

      const cores = [
        { stroke: '#F2884B', text: 'text-accent-500', bg: 'bg-accent-500' },       // Pro / Orange
        { stroke: '#E7D181', text: 'text-accent-400', bg: 'bg-accent-400' },       // Enterprise / Gold
        { stroke: '#F2E530', text: 'text-accent-300', bg: 'bg-accent-300' },       // Essencial / Yellow
        { stroke: '#EFEDDD', text: 'text-zinc-350', bg: 'bg-zinc-500' },           // Sem plano / Cream
      ];
      const cor = cores[idx % cores.length];

      return {
        plano: p.plano,
        clientes: p.clientes,
        mrr: p.mrr,
        pct: Math.round(pct * 100),
        strokeDash: `${strokeLength.toFixed(2)} ${circ.toFixed(2)}`,
        strokeOffset: strokeOffset.toFixed(2),
        ...cor
      };
    });
  });

  sparklinePath(valores: number[], width = 100, height = 30): { line: string, area: string } {
    if (!valores || valores.length < 2) return { line: '', area: '' };
    const maxVal = Math.max(...valores);
    const minVal = Math.min(...valores);
    const range = maxVal === minVal ? 1 : (maxVal - minVal);
    
    const points = valores.map((val, idx) => {
      const x = (idx / (valores.length - 1)) * width;
      const y = height - 2 - ((val - minVal) / range) * (height - 4);
      return { x, y };
    });

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const area = `${line} L ${width} ${height} L 0 ${height} Z`;
    return { line, area };
  }

  readonly estagios: { valor: EstagioFiltro; label: string }[] = [
    { valor: 'todos', label: 'Todos' },
    { valor: 'ativo', label: 'Ativos' },
    { valor: 'trial', label: 'Trial' },
    { valor: 'em_atraso', label: 'Em atraso' },
    { valor: 'lead', label: 'Leads' },
    { valor: 'churn', label: 'Churn' },
  ];

  readonly clientesFiltrados = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    const estagio = this.filtroEstagio();
    const ord = this.ordenacao();

    let lista = this.clientes().filter((c) => {
      const matchEstagio = estagio === 'todos' || c.estagio === estagio;
      const matchBusca =
        !termo ||
        c.nome.toLowerCase().includes(termo) ||
        (c.cidade ?? '').toLowerCase().includes(termo) ||
        (c.identificacao ?? '').toLowerCase().includes(termo) ||
        (c.contatoPrincipal?.nome ?? '').toLowerCase().includes(termo);
      return matchEstagio && matchBusca;
    });

    lista = [...lista].sort((a, b) => {
      switch (ord) {
        case 'health':
          return b.healthScore - a.healthScore;
        case 'nome':
          return a.nome.localeCompare(b.nome);
        case 'vencimento':
          return (a.diasParaVencer ?? 9999) - (b.diasParaVencer ?? 9999);
        default:
          return b.mrr - a.mrr;
      }
    });
    return lista;
  });

  // --- Computeds dinâmicos para aba Faturamento ---
  readonly faturasFiltradas = computed(() => {
    const filtro = this.filtroFatura();
    if (filtro === 'todos') return this.faturas();
    return this.faturas().filter(f => f.status === filtro);
  });

  readonly faturamentoCards = computed(() => {
    const lista = this.faturas();
    const emitido = lista.reduce((s, f) => s + f.valor, 0);
    const recebido = lista.filter(f => f.status === 'paga').reduce((s, f) => s + f.valor, 0);
    const pendente = lista.filter(f => f.status === 'pendente').reduce((s, f) => s + f.valor, 0);
    const inadimplencia = lista.filter(f => f.status === 'vencida').reduce((s, f) => s + f.valor, 0);
    const taxa = emitido > 0 ? Math.round((inadimplencia / emitido) * 100) : 0;
    return { emitido, recebido, pendente, inadimplencia, taxa };
  });

  ngOnInit(): void {
    this.carregar();
    this.verificarConexao();
    // Auto-refresh do health check a cada 30s
    this.healthInterval = setInterval(() => this.verificarConexao(), 30000);
  }

  ngOnDestroy(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }
  }

  verificarConexao(): void {
    this.healthLoading.set(true);
    this.api.health().subscribe({
      next: (h) => {
        this.dbHealth.set(h);
        this.healthLoading.set(false);
      },
      error: () => {
        this.dbHealth.set({ connected: false, mode: 'mock', totalCondominios: 0, serverTime: new Date().toISOString(), dbLatencyMs: -1 });
        this.healthLoading.set(false);
      }
    });
  }

  carregar(): void {
    this.loading.set(true);
    this.erro.set(null);
    forkJoin({ overview: this.api.overview(), clientes: this.api.clientes() }).subscribe({
      next: ({ overview, clientes }) => {
        this.overview.set(overview);
        this.clientes.set(clientes);
        this.loading.set(false);
      },
      error: () => {
        this.erro.set('Não foi possível carregar os dados do CRM. Tente novamente.');
        this.loading.set(false);
      },
    });
  }

  onBuscaInput(v: string): void {
    this.buscaRaw.set(v);
    clearTimeout(this.buscaTimer);
    this.buscaTimer = setTimeout(() => this.busca.set(v), 200);
  }

  limparBusca(): void {
    clearTimeout(this.buscaTimer);
    this.buscaRaw.set('');
    this.busca.set('');
  }

  abrirCliente(c: CrmCliente): void {
    this.abaSelecionada.set('geral');
    this.clienteSelecionado.set(c);
    this.modoEdicao.set(false);
  }

  fecharCliente(): void {
    this.clienteSelecionado.set(null);
    this.modoEdicao.set(false);
  }

  iniciarEdicao(): void {
    const c = this.clienteSelecionado();
    if (!c) return;

    let dataVenc = '';
    if (c.vencimento) {
      dataVenc = c.vencimento.split('T')[0];
    }

    this.dadosEditados = {
      nome: c.nome,
      identificacao: c.identificacao ?? '',
      plano: c.plano ?? 'Sem plano',
      totalApartamentos: c.totalApartamentos,
      mrr: c.mrr,
      vencimento: dataVenc,
      recorrenciaAtiva: c.recorrenciaAtiva,
      cobrancaAutoWhats: c.cobrancaAutoWhats,
      sindicoNome: c.contatoPrincipal?.nome ?? '',
      sindicoEmail: c.contatoPrincipal?.email ?? '',
      sindicoTelefone: c.contatoPrincipal?.telefone ?? '',
    };
    this.modoEdicao.set(true);
  }

  atualizarMrrCalculado(): void {
    const planoName = this.dadosEditados.plano;
    const uh = this.dadosEditados.totalApartamentos || 0;
    
    const planoConfig = this.configPlanos().find(p => p.plano === planoName);
    if (planoConfig) {
      this.dadosEditados.mrr = planoConfig.valorBase + (uh * planoConfig.valorPorUH);
    } else {
      this.dadosEditados.mrr = 0;
    }
  }

  cancelarEdicao(): void {
    this.modoEdicao.set(false);
  }

  salvarEdicao(): void {
    const c = this.clienteSelecionado();
    if (!c) return;

    this.salvando.set(true);
    this.api.atualizar(c.id, this.dadosEditados).subscribe({
      next: (res) => {
        this.salvando.set(false);
        this.modoEdicao.set(false);
        this.clienteSelecionado.set(res.data);
        this.carregar();
        this.triggerToast('Dados do condomínio atualizados com sucesso.', 'success');
      },
      error: (err) => {
        console.error('Erro ao salvar cliente:', err);
        this.salvando.set(false);
        this.triggerToast('Não foi possível salvar as alterações. Verifique os dados e tente novamente.', 'error');
      }
    });
  }

  exportarRelatorio(): void {
    const c = this.clienteSelecionado();
    if (!c) return;
    const url = this.api.exportarUrl(c.id);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crm-relatorio-condominio-${c.id}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  @ViewChild('buscaInput') buscaInputEl?: ElementRef<HTMLInputElement>;

  // Acessibilidade: Esc fecha o painel de detalhes (padrão de diálogo modal).
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.clienteSelecionado()) this.fecharCliente();
  }

  // Atalho: "/" foca a busca na aba Clientes (quando não está digitando em outro campo).
  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key !== '/' || this.abaNavegacao() !== 'clientes' || this.clienteSelecionado()) return;
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    e.preventDefault();
    this.buscaInputEl?.nativeElement.focus();
  }

  // ---- Helpers de apresentação ----

  estagioLabel(e: EstagioCrm): string {
    return (
      { lead: 'Lead', trial: 'Trial', ativo: 'Ativo', em_atraso: 'Em atraso', churn: 'Churn' } as Record<EstagioCrm, string>
    )[e];
  }

  estagioClasse(e: EstagioCrm): string {
    return (
      {
        ativo: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
        trial: 'text-sky-400 bg-sky-500/10 border-sky-500/25',
        lead: 'text-violet-400 bg-violet-500/10 border-violet-500/25',
        em_atraso: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
        churn: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
      } as Record<EstagioCrm, string>
    )[e];
  }

  pagamentoLabel(s: StatusPagamento): string {
    return (
      { em_dia: 'Em dia', vencendo: 'Vencendo', atrasado: 'Atrasado', sem_cobranca: 'Sem cobrança' } as Record<StatusPagamento, string>
    )[s];
  }

  pagamentoClasse(s: StatusPagamento): string {
    return (
      {
        em_dia: 'text-emerald-400',
        vencendo: 'text-amber-400',
        atrasado: 'text-rose-400',
        sem_cobranca: 'text-zinc-500',
      } as Record<StatusPagamento, string>
    )[s];
  }

  riscoLabel(nivel: 'alto' | 'medio' | 'baixo'): string {
    return ({ alto: 'Risco alto', medio: 'Risco médio', baixo: 'Estável' } as Record<string, string>)[nivel];
  }

  riscoClasse(nivel: 'alto' | 'medio' | 'baixo'): string {
    return (
      {
        alto: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
        medio: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
        baixo: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
      } as Record<string, string>
    )[nivel];
  }

  healthClasse(score: number): string {
    if (score >= 70) return 'text-emerald-400';
    if (score >= 40) return 'text-amber-400';
    return 'text-rose-400';
  }

  healthBg(score: number): string {
    if (score >= 70) return 'bg-emerald-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-rose-500';
  }

  severidadeClasse(s: 'alta' | 'media' | 'baixa'): string {
    return (
      {
        alta: 'border-rose-500/30 bg-rose-500/[0.07]',
        media: 'border-amber-500/30 bg-amber-500/[0.07]',
        baixa: 'border-white/[0.08] bg-white/[0.02]',
      } as Record<string, string>
    )[s];
  }

  severidadeDot(s: 'alta' | 'media' | 'baixa'): string {
    return (
      { alta: 'bg-rose-400', media: 'bg-amber-400', baixa: 'bg-zinc-500' } as Record<string, string>
    )[s];
  }

  iniciais(nome: string): string {
    return nome
      .split(' ')
      .filter((p) => p.length > 2)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  }

  moeda(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  estagioCount(estagio: EstagioCrm): number {
    const ov = this.overview();
    return ov ? ov.porEstagio[estagio] : 0;
  }

  estagioPct(estagio: EstagioCrm): number {
    const ov = this.overview();
    if (!ov || !ov.totalClientes) return 0;
    return Math.round((ov.porEstagio[estagio] / ov.totalClientes) * 100);
  }

  planoPct(mrr: number): number {
    const ov = this.overview();
    if (!ov || !ov.mrrTotal) return 0;
    return Math.round((mrr / ov.mrrTotal) * 100);
  }

  alterarAbaNavegacao(aba: 'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes'): void {
    this.abaNavegacao.set(aba);
    // Limpar cliente selecionado ao trocar de aba principal para evitar sobreposições
    this.clienteSelecionado.set(null);
  }

  confirmarPagamentoManual(idFatura: string): void {
    this.ultimaFaturaPaga.set(idFatura);
    setTimeout(() => {
      if (this.ultimaFaturaPaga() === idFatura) this.ultimaFaturaPaga.set(null);
    }, 1400);
    this.faturas.update(lista =>
      lista.map(f => {
        if (f.id === idFatura) {
          const faturaAtualizada = { ...f, status: 'paga', dataPagamento: new Date().toISOString() };
          
          // Lógica secundária: atualizar status do cliente
          const cliId = f.clienteId;
          this.clientes.update(clientesLista =>
            clientesLista.map(c => {
              if (c.id === cliId) {
                return { ...c, statusPagamento: 'em_dia' as StatusPagamento, estagio: 'ativo' as EstagioCrm, diasParaVencer: 30 };
              }
              return c;
            })
          );

          // Atualizar KPIs consolidados no signal overview
          const ov = this.overview();
          if (ov) {
            const novaQtd = Math.max(0, ov.emAtraso.quantidade - 1);
            const novoVal = Math.max(0, ov.emAtraso.valor - f.valor);
            this.overview.set({
              ...ov,
              emAtraso: { quantidade: novaQtd, valor: novoVal }
            });
          }

          // Registrar no log
          this.pushLog({
            data: new Date().toISOString(),
            origem: 'System',
            evento: 'manual_payment_override',
            status: 'sucesso',
            payload: JSON.stringify({ faturaId: idFatura, valor: f.valor, condominio: f.condominio })
          });

          this.triggerToast(`Fatura ${idFatura} liquidada manualmente com sucesso.`, 'success');
          return faturaAtualizada;
        }
        return f;
      })
    );
  }

  reenviarWhatsApp(idFatura: string): void {
    const fat = this.faturas().find(f => f.id === idFatura);
    if (!fat) return;

    const dataAtual = new Date().toISOString();
    this.ultimoDisparoData.set(dataAtual);
    setTimeout(() => {
      if (this.ultimoDisparoData() === dataAtual) this.ultimoDisparoData.set(null);
    }, 1800);
    this.historicoDisparos.update(disp => [
      {
        data: dataAtual,
        condominio: fat.condominio,
        tipo: fat.status === 'vencida' ? 'Cobrança atrasada' : 'Aviso prévio',
        status: 'entregue',
        telefone: '(11) 99999-8888',
        erroMsg: null
      },
      ...disp
    ]);

    // Log técnico
    this.pushLog({
      data: dataAtual,
      origem: 'Z-API',
      evento: 'message_sent',
      status: 'sucesso',
      payload: JSON.stringify({ faturaId: idFatura, destinatario: fat.condominio, status: 'enviado_manual' })
    });

    this.triggerToast(`Notificação enviada com sucesso para o condomínio ${fat.condominio}.`, 'success');
  }

  salvarReguaWhatsApp(): void {
    this.salvandoRegua.set(true);
    setTimeout(() => {
      this.salvandoRegua.set(false);
      this.triggerToast('Regulagem de automação e templates do WhatsApp salvos.', 'success');
      
      this.pushLog({
        data: new Date().toISOString(),
        origem: 'System',
        evento: 'config_updated',
        status: 'info',
        payload: '{"section":"automacoes_whatsapp","updatedBy":"admin@clickprestare.com.br"}'
      });
    }, 800);
  }

  salvarConfiguracaoPlanos(): void {
    this.salvandoConfigPlanos.set(true);
    setTimeout(() => {
      this.salvandoConfigPlanos.set(false);
      this.triggerToast('Tabela de preços e limites de planos salva.', 'success');
      
      this.pushLog({
        data: new Date().toISOString(),
        origem: 'System',
        evento: 'config_updated',
        status: 'info',
        payload: '{"section":"tabela_planos","updatedBy":"admin@clickprestare.com.br"}'
      });
    }, 800);
  }

  salvarCredenciaisGateways(): void {
    this.salvandoGateways.set(true);
    setTimeout(() => {
      this.salvandoGateways.set(false);
      this.triggerToast('Chaves de API e tokens de gateways atualizados.', 'success');
      
      this.pushLog({
        data: new Date().toISOString(),
        origem: 'System',
        evento: 'config_updated',
        status: 'info',
        payload: '{"section":"gateways_api","updatedBy":"admin@clickprestare.com.br"}'
      });
    }, 800);
  }

  triggerToast(msg: string, tipo: 'success' | 'error' | 'info' = 'info'): void {
    const id = ++this.toastSeq;
    this.toasts.update((list) => [...list, { id, message: msg, tipo }]);
    setTimeout(() => this.dismissToast(id), tipo === 'error' ? 5000 : 3200);
  }

  dismissToast(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
