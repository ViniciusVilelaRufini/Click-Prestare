import { Component, HostListener, OnInit, OnDestroy, ViewChild, ElementRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CrmApi, CrmCliente, CrmHealth, CrmOverview, EstagioCrm, StatusPagamento } from './crm.service';
import { AuthService } from '../auth/auth.service';
import { CountUpDirective } from '../shared/count-up.directive';

type StatusFatura = 'todos' | 'paga' | 'pendente' | 'vencida';

export interface Fatura {
  id: string;
  clienteId: number;
  condominio: string;
  valor: number;
  vencimento: string;
  metodoPagamento: string;
  status: 'paga' | 'pendente' | 'vencida';
  dataPagamento: string | null;
}

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
  readonly abaSelecionada = signal<'geral' | 'portaria' | 'servicos' | 'moradores'>('geral');
  readonly Math = Math;

  // --- Estados de Gestão de Moradores ---
  readonly moradores = signal<any[]>([]);
  readonly apartamentos = signal<any[]>([]);
  readonly moradoresLoading = signal(false);
  readonly buscaMorador = signal('');
  readonly mostrandoFormMorador = signal(false);

  // Campos do formulário de criação de moradores
  readonly registrarNome = signal('');
  readonly registrarTelefone = signal('');
  readonly registrarEmail = signal('');
  readonly registrarAptoId = signal<number | null>(null);
  readonly registrarDocumento = signal('');
  readonly registrarSenha = signal('');

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

  // --- Estados detalhados e personalizados de Faturamento ---
  readonly selectedKpiCard = signal<'emitido' | 'recebido' | 'pendente' | 'inadimplencia' | null>(null);
  readonly faturaDetalhada = signal<Fatura | null>(null);
  readonly whatsCobrancaFatura = signal<Fatura | null>(null);
  readonly whatsMensagemRascunho = signal<string>('');
  readonly whatsTelefoneDestinatario = signal<string>('');
  readonly baixaManualFatura = signal<Fatura | null>(null);

  // Campos do formulário de baixa manual
  readonly baixaMetodo = signal<'Pix' | 'Boleto' | 'Dinheiro' | 'Transferência' | 'Outro'>('Pix');
  readonly baixaData = signal<string>('');
  readonly baixaHora = signal<string>('');
  readonly baixaValor = signal<number>(0);
  readonly baixaObservacoes = signal<string>('');

  // Metadados das baixas manuais realizadas (chave: faturaId)
  readonly manualPaymentsMetadata = signal<Record<string, { metodo: string, dataPagamento: string, valorPago: number, obs: string }>>({});

  // --- Estado de Navegação CRM ---
  readonly abaNavegacao = signal<'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes' | 'relatorios' | 'chamados'>('overview');

  // --- Estados de Ocorrências / Chamados ---
  readonly ocorrenciasList = signal<any[]>([]);
  readonly subFiltroChamados = signal<'todos' | 'app' | 'facial' | 'acesso'>('todos');
  readonly ocorrenciasFiltradas = computed(() => {
    const list = this.ocorrenciasList();
    const subFiltro = this.subFiltroChamados();

    const techKeywords = [
      'app', 'aplicativo', 'facial', 'face', 'reconhecimento',
      'sistema', 'software', 'bug', 'erro', 'falha', 'instabilidade',
      'entrar', 'acesso', 'bloqueado', 'bloqueada', 'nao consegue',
      'nao esta conseguindo', 'liberar', 'liberacao', 'visitante',
      'morador', 'botoeira', 'portao', 'abrir', 'abre', 'travado',
      'travada', 'controle de acesso', 'rfid', 'tag', 'chaveiro',
      'biometria', 'leitor', 'leitora', 'interfone', 'tecnico', 'tecnica',
      'camera'
    ];

    const normalize = (text: string): string => {
      return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    };

    // 1. Filtra permanentemente ocorrências não-técnicas (oculta barulho, lixo, etc.)
    const baseTechList = list.filter((o) => {
      const desc = normalize(o.descricao || '');
      const cat = normalize(o.categoria?.nome || '');
      return techKeywords.some((k) => desc.includes(k) || cat.includes(k));
    });

    // 2. Aplica sub-filtros específicos de suporte B2B
    if (subFiltro === 'todos') {
      return baseTechList;
    }

    let filterKeywords: string[] = [];
    if (subFiltro === 'app') {
      filterKeywords = ['app', 'aplicativo', 'sistema', 'software', 'bug', 'erro', 'falha', 'instabilidade', 'senha', 'cadastro', 'login'];
    } else if (subFiltro === 'facial') {
      filterKeywords = ['facial', 'face', 'reconhecimento', 'camera'];
    } else if (subFiltro === 'acesso') {
      filterKeywords = ['botoeira', 'portao', 'abrir', 'abre', 'travado', 'travada', 'controle de acesso', 'rfid', 'tag', 'chaveiro', 'biometria', 'leitor', 'leitora', 'interfone', 'acesso', 'entrar', 'bloqueado', 'bloqueada', 'nao consegue', 'nao esta conseguindo', 'liberar', 'liberacao', 'visitante', 'morador', 'tecnico', 'tecnica'];
    }

    return baseTechList.filter((o) => {
      const desc = normalize(o.descricao || '');
      const cat = normalize(o.categoria?.nome || '');
      return filterKeywords.some((k) => desc.includes(k) || cat.includes(k));
    });
  });
  readonly ocorrenciasLoading = signal(false);
  readonly ocorrenciaSelecionada = signal<any | null>(null);
  readonly respostaTexto = signal('');
  readonly enviandoResposta = signal(false);

  // --- Controle de Reabertura de Chamado ---
  readonly reabrindoChamado = signal(false);
  reaberturaTexto = '';
  readonly enviandoReabertura = signal(false);


  // --- Chat de Ocorrências ---
  readonly chatMensagens = signal<any[]>([]);
  readonly loadingChatMensagens = signal(false);
  chatNovaMensagem = '';
  chatInterval: any = null;


  // --- Modal Novo Chamado ---
  readonly modalNovoChamadoAberto = signal(false);
  readonly novoChamadoCondominioId = signal<number | null>(null);
  readonly novoChamadoDescricao = signal('');
  readonly criandoNovoChamado = signal(false);


  // --- Estados da aba de Relatórios ---
  readonly relatorioTipo = signal<'financeiro' | 'clientes' | 'portaria' | 'notificacoes'>('financeiro');
  readonly relatorioPeriodo = signal<'30d' | '90d' | 'ano' | 'tudo'>('tudo');
  readonly relatorioGerado = signal(true);
  readonly gerandoRelatorio = signal(false);

  // --- Faturamento & Faturas Dinâmicos ---
  readonly faturas = computed<Fatura[]>(() => {
    const lista: Fatura[] = [];
    const clientes = this.clientes();
    
    for (const c of clientes) {
      if (c.mrr <= 0 || !c.vencimento) continue;
      
      const dateVenc = new Date(c.vencimento);
      const metodoPagamento = c.recorrenciaAtiva ? 'Pix' : 'Boleto';

      // 1. Current Month's Invoice
      let status: 'paga' | 'pendente' | 'vencida' = 'paga';
      if (c.statusPagamento === 'atrasado') status = 'vencida';
      else if (c.statusPagamento === 'vencendo') status = 'pendente';
      else if (c.statusPagamento === 'em_dia') status = 'paga';

      const dataPagamento = status === 'paga' 
        ? new Date(dateVenc.getTime() - 2 * 24 * 3600 * 1000).toISOString()
        : null;

      lista.push({
        id: `FT-${dateVenc.getFullYear()}-${String(dateVenc.getMonth() + 1).padStart(2, '0')}-${c.id}`,
        clienteId: c.id,
        condominio: c.nome,
        valor: c.mrr,
        vencimento: c.vencimento,
        metodoPagamento,
        status,
        dataPagamento
      });

      // 2. Previous Month's Invoice (30 days ago) - Assumed paid
      const prevVenc = new Date(dateVenc);
      prevVenc.setDate(prevVenc.getDate() - 30);
      lista.push({
        id: `FT-${prevVenc.getFullYear()}-${String(prevVenc.getMonth() + 1).padStart(2, '0')}-${c.id}`,
        clienteId: c.id,
        condominio: c.nome,
        valor: c.mrr,
        vencimento: prevVenc.toISOString(),
        metodoPagamento,
        status: 'paga',
        dataPagamento: new Date(prevVenc.getTime() - 2 * 24 * 3600 * 1000).toISOString()
      });

      // 3. Older Month's Invoice (60 days ago) - Assumed paid
      const prevPrevVenc = new Date(dateVenc);
      prevPrevVenc.setDate(prevPrevVenc.getDate() - 60);
      lista.push({
        id: `FT-${prevPrevVenc.getFullYear()}-${String(prevPrevVenc.getMonth() + 1).padStart(2, '0')}-${c.id}`,
        clienteId: c.id,
        condominio: c.nome,
        valor: c.mrr,
        vencimento: prevPrevVenc.toISOString(),
        metodoPagamento,
        status: 'paga',
        dataPagamento: new Date(prevPrevVenc.getTime() - 3 * 24 * 3600 * 1000).toISOString()
      });
    }

    // Sort by vencimento descending (most recent first)
    return lista.sort((a, b) => new Date(b.vencimento).getTime() - new Date(a.vencimento).getTime());
  });

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

  readonly faturasDoCardSelecionado = computed<Fatura[]>(() => {
    const card = this.selectedKpiCard();
    if (!card) return [];
    const lista = this.faturas();
    if (card === 'emitido') return lista;
    if (card === 'recebido') return lista.filter(f => f.status === 'paga');
    if (card === 'pendente') return lista.filter(f => f.status === 'pendente');
    if (card === 'inadimplencia') return lista.filter(f => f.status === 'vencida');
    return [];
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
    if (this.chatInterval) {
      clearInterval(this.chatInterval);
    }
    this.limparIntervaloOcorrencias();
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
    this.moradores.set([]);
    this.apartamentos.set([]);
  }

  fecharCliente(): void {
    this.clienteSelecionado.set(null);
    this.modoEdicao.set(false);
  }

  selecionarAba(aba: 'geral' | 'portaria' | 'servicos' | 'moradores'): void {
    this.abaSelecionada.set(aba);
    if (aba === 'moradores') {
      const c = this.clienteSelecionado();
      if (c) {
        this.carregarMoradoresEApartamentos(c.id);
      }
    }
  }

  gerarMockMoradores(idCondominio: number, count: number): any[] {
    const nomes = ['João Silva', 'Maria Oliveira', 'Carlos Souza', 'Ana Santos', 'Pedro Lima', 'Julia Costa', 'Lucas Fernandes', 'Beatriz Alencar', 'Marcos Rocha', 'Fernanda Ribeiro'];
    const blocos = ['A', 'B', 'C'];
    const tipos = ['proprietario', 'inquilino'];
    
    const list: any[] = [];
    for (let i = 0; i < count; i++) {
      const nome = nomes[i % nomes.length] + (i >= nomes.length ? ` ${Math.floor(i / nomes.length) + 1}` : '');
      const bloco = blocos[i % blocos.length];
      const aptoNum = 100 + (Math.floor(i / blocos.length) + 1) * 10 + (i % 3);
      const telefone = `(17) 992${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 9000 + 1000)}`;
      const email = `${nome.toLowerCase().replace(/\s/g, '.')}@click.com`;
      list.push({
        id: 1000 + i,
        nome,
        documento: `111222333${String(i).padStart(2, '0')}`,
        email,
        telefone,
        tipo: tipos[i % tipos.length],
        bloco,
        apartamento: String(aptoNum),
        id_apartamento: 100 + i,
        id_condominio: idCondominio,
        photo: null,
        face_id: `face_${1000 + i}`,
        face_sync_status: 'sincronizado'
      });
    }
    return list;
  }

  gerarMockApartamentos(idCondominio: number): any[] {
    const list: any[] = [];
    const blocos = ['A', 'B', 'C'];
    let id = 1;
    for (const b of blocos) {
      for (let andar = 1; andar <= 4; andar++) {
        for (let num = 1; num <= 4; num++) {
          list.push({
            id: id++,
            apto: `${andar}0${num}`,
            bloco: b,
            id_condominio: idCondominio
          });
        }
      }
    }
    return list;
  }

  carregarMoradoresEApartamentos(idCondominio: number): void {
    this.moradoresLoading.set(true);
    this.buscaMorador.set('');
    this.mostrandoFormMorador.set(false);

    if (this.dbHealth()?.connected) {
      forkJoin({
        moradores: this.api.getMoradores(idCondominio),
        apartamentos: this.api.getApartamentos(idCondominio)
      }).subscribe({
        next: ({ moradores, apartamentos }) => {
          this.moradores.set(moradores);
          this.apartamentos.set(apartamentos);
          this.moradoresLoading.set(false);
        },
        error: (err) => {
          console.error('Erro ao carregar moradores da API:', err);
          const client = this.clientes().find(c => c.id === idCondominio);
          const count = client ? client.totalMoradores : 5;
          this.moradores.set(this.gerarMockMoradores(idCondominio, count));
          this.apartamentos.set(this.gerarMockApartamentos(idCondominio));
          this.moradoresLoading.set(false);
        }
      });
    } else {
      setTimeout(() => {
        const client = this.clientes().find(c => c.id === idCondominio);
        const count = client ? client.totalMoradores : 5;
        this.moradores.set(this.gerarMockMoradores(idCondominio, count));
        this.apartamentos.set(this.gerarMockApartamentos(idCondominio));
        this.moradoresLoading.set(false);
      }, 500);
    }
  }

  abrirFormMorador(): void {
    this.registrarNome.set('');
    this.registrarTelefone.set('');
    this.registrarEmail.set('');
    this.registrarAptoId.set(null);
    this.registrarDocumento.set('');
    const senhaProvisoria = Math.floor(100000 + Math.random() * 900000).toString();
    this.registrarSenha.set(senhaProvisoria);
    this.mostrandoFormMorador.set(true);
  }

  resetFormMorador(): void {
    this.mostrandoFormMorador.set(false);
  }

  gerarMensagemWhatsApp(morador: any, senha: string, condominioNome: string): string {
    return `Olá, *${morador.nome}*!\n` +
           `Seu acesso ao aplicativo *Click Prestare* foi cadastrado.\n\n` +
           `Condomínio: *${condominioNome}*\n` +
           `Apartamento: *${morador.bloco ? morador.bloco + ' - ' : ''}${morador.apartamento}*\n` +
           `Login/E-mail: \`${morador.email || 'Não informado'}\`\n` +
           `Senha de Acesso: \`${senha}\`\n\n` +
           `Baixe o app no link abaixo e insira seus dados para acessar:\n` +
           `Android: https://play.google.com/store\n` +
           `iOS: https://apple.com/app-store\n\n` +
           `Seja bem-vindo!`;
  }

  dispararWhatsAppCredenciais(morador: any, senha: string, condominioNome: string): void {
    if (!morador.telefone) {
      this.triggerToast('Morador cadastrado sem número de telefone para WhatsApp.', 'info');
      return;
    }

    const cleanPhone = morador.telefone.replace(/\D/g, '');
    const phoneWithDdd = cleanPhone.length <= 11 ? '55' + cleanPhone : cleanPhone;
    const msg = this.gerarMensagemWhatsApp(morador, senha, condominioNome);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(msg).then(() => {
        this.triggerToast('Credenciais copiadas para a área de transferência.', 'success');
      }).catch(err => console.error('Erro ao copiar credenciais:', err));
    }

    const waLink = `https://wa.me/${phoneWithDdd}?text=${encodeURIComponent(msg)}`;
    window.open(waLink, '_blank');
  }

  salvarMorador(): void {
    const c = this.clienteSelecionado();
    if (!c) return;

    const nome = this.registrarNome().trim();
    const telefone = this.registrarTelefone().trim();
    const email = this.registrarEmail().trim();
    const aptoId = this.registrarAptoId();
    const documento = this.registrarDocumento().trim();
    const senha = this.registrarSenha().trim();

    if (!nome) {
      this.triggerToast('O nome do morador é obrigatório.', 'error');
      return;
    }
    if (!aptoId) {
      this.triggerToast('Selecione o apartamento do morador.', 'error');
      return;
    }

    const apto = this.apartamentos().find(a => a.id === aptoId);
    const aptoLabel = apto ? apto.apto : '';
    const blocoLabel = apto ? apto.bloco : '';

    const newMoradorDto = {
      nome,
      documento: documento || null,
      email: email || null,
      telefone: telefone || null,
      tipo: 'proprietario',
      id_apartamento: aptoId,
      sendCredentials: true
    };

    this.moradoresLoading.set(true);

    if (this.dbHealth()?.connected) {
      this.api.createMorador(c.id, newMoradorDto).subscribe({
        next: (created) => {
          this.moradores.update(m => [created, ...m]);
          c.totalMoradores += 1;
          this.moradoresLoading.set(false);
          this.triggerToast(`Morador ${nome} registrado com sucesso.`, 'success');
          
          this.dispararWhatsAppCredenciais(created, senha, c.nome);
          this.resetFormMorador();
        },
        error: (err) => {
          this.moradoresLoading.set(false);
          this.triggerToast('Erro ao registrar morador no servidor.', 'error');
          console.error(err);
        }
      });
    } else {
      const mockCreated = {
        id: Date.now(),
        nome,
        documento,
        email,
        telefone,
        tipo: 'proprietario',
        bloco: blocoLabel,
        apartamento: aptoLabel,
        id_apartamento: aptoId,
        id_condominio: c.id,
        photo: null,
        face_id: `face_${Date.now()}`,
        face_sync_status: 'sincronizado'
      };
      
      setTimeout(() => {
        this.moradores.update(m => [mockCreated, ...m]);
        c.totalMoradores += 1;
        this.moradoresLoading.set(false);
        this.triggerToast(`Morador ${nome} registrado com sucesso.`, 'success');
        
        this.dispararWhatsAppCredenciais(mockCreated, senha, c.nome);
        this.resetFormMorador();
      }, 600);
    }
  }

  reenviarCredenciaisMorador(morador: any): void {
    const c = this.clienteSelecionado();
    if (!c) return;
    this.dispararWhatsAppCredenciais(morador, morador.documento || '123456', c.nome);
  }

  removerMorador(moradorId: number): void {
    const c = this.clienteSelecionado();
    if (!c) return;

    if (confirm('Deseja realmente remover este morador?')) {
      this.moradoresLoading.set(true);
      
      setTimeout(() => {
        this.moradores.update(list => list.filter(m => m.id !== moradorId));
        if (c.totalMoradores > 0) c.totalMoradores -= 1;
        this.moradoresLoading.set(false);
        this.triggerToast('Morador removido com sucesso.', 'success');
      }, 500);
    }
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

  ocorrenciasInterval: any = null;

  alterarAbaNavegacao(aba: 'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes' | 'relatorios' | 'chamados'): void {
    this.abaNavegacao.set(aba);
    // Limpar cliente selecionado ao trocar de aba principal para evitar sobreposições
    this.clienteSelecionado.set(null);
    this.limparIntervaloOcorrencias();

    if (aba === 'chamados') {
      this.carregarOcorrencias();
      // Polling a cada 10 segundos para novos chamados no CRM
      this.ocorrenciasInterval = setInterval(() => {
        this.recargaSilenciosaOcorrencias();
      }, 10000);
    }
  }

  carregarOcorrencias(): void {
    this.ocorrenciasLoading.set(true);
    this.api.getOcorrencias().subscribe({
      next: (data) => {
        this.ocorrenciasList.set(data);
        this.ocorrenciasLoading.set(false);
      },
      error: (err) => {
        console.error('Erro ao carregar ocorrências no CRM:', err);
        this.ocorrenciasLoading.set(false);
      }
    });
  }

  recargaSilenciosaOcorrencias(): void {
    this.api.getOcorrencias().subscribe({
      next: (data) => {
        this.ocorrenciasList.set(data);
      }
    });
  }

  private limparIntervaloOcorrencias(): void {
    if (this.ocorrenciasInterval) {
      clearInterval(this.ocorrenciasInterval);
      this.ocorrenciasInterval = null;
    }
  }


  abrirRespostaOcorrencia(o: any): void {
    this.ocorrenciaSelecionada.set(o);
    this.respostaTexto.set(o.resposta || '');
    this.chatMensagens.set([]);
    this.chatNovaMensagem = '';
    this.limparIntervaloChat();
    this.carregarMensagensChat(o.id);
    
    // Polling a cada 2.5s para receber novas mensagens
    this.chatInterval = setInterval(() => {
      this.atualizarChatSilenciosamente(o.id);
    }, 2500);
  }

  fecharRespostaOcorrencia(): void {
    this.limparIntervaloChat();
    this.ocorrenciaSelecionada.set(null);
    this.respostaTexto.set('');
    this.reabrindoChamado.set(false);
    this.reaberturaTexto = '';
  }


  private limparIntervaloChat(): void {
    if (this.chatInterval) {
      clearInterval(this.chatInterval);
      this.chatInterval = null;
    }
  }

  carregarMensagensChat(idOcorrencia: number): void {
    this.loadingChatMensagens.set(true);
    this.api.listMessages(idOcorrencia).subscribe({
      next: (msgs) => {
        this.chatMensagens.set(msgs);
        this.loadingChatMensagens.set(false);
        this.scrollChatParaFim();
      },
      error: (err) => {
        console.error('Erro ao carregar mensagens do chat:', err);
        this.loadingChatMensagens.set(false);
      }
    });
  }

  atualizarChatSilenciosamente(idOcorrencia: number): void {
    this.api.listMessages(idOcorrencia).subscribe({
      next: (msgs) => {
        if (msgs.length !== this.chatMensagens().length) {
          this.chatMensagens.set(msgs);
          this.scrollChatParaFim();
        }
      }
    });
  }

  enviarMensagemChat(): void {
    const o = this.ocorrenciaSelecionada();
    const msg = this.chatNovaMensagem.trim();
    if (!o || !msg) return;

    this.api.sendMessage(o.id, msg).subscribe({
      next: (novaMsg) => {
        this.chatMensagens.update(curr => [...curr, novaMsg]);
        this.chatNovaMensagem = '';
        this.scrollChatParaFim();
      },
      error: (err) => {
        console.error('Erro ao enviar mensagem:', err);
        this.triggerToast('Erro ao enviar mensagem de chat.', 'error');
      }
    });
  }


  private scrollChatParaFim(): void {
    setTimeout(() => {
      const container = document.getElementById('crm-chat-container');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }


  enviarRespostaOcorrencia(): void {
    const o = this.ocorrenciaSelecionada();
    const resp = this.respostaTexto().trim();
    if (!o || !resp) return;

    this.enviandoResposta.set(true);
    this.api.responderOcorrencia(o.id, resp).subscribe({
      next: () => {
        this.enviandoResposta.set(false);
        this.triggerToast('Chamado respondido e resolvido com sucesso!', 'success');
        this.fecharRespostaOcorrencia();
        this.carregarOcorrencias(); // Recarrega a lista
        this.carregar(); // Recarrega overview para atualizar contadores
      },
      error: (err) => {
        console.error(err);
        this.enviandoResposta.set(false);
        this.triggerToast('Erro ao responder chamado.', 'error');
      }
    });
  }

  iniciarReabertura(): void {
    this.reabrindoChamado.set(true);
    this.reaberturaTexto = '';
  }

  cancelarReabertura(): void {
    this.reabrindoChamado.set(false);
    this.reaberturaTexto = '';
  }

  confirmarReabertura(idOcorrencia: number): void {
    const info = this.reaberturaTexto.trim();
    if (!info) return;

    this.enviandoReabertura.set(true);
    this.api.reabrirOcorrencia(idOcorrencia, info).subscribe({
      next: (res) => {
        this.enviandoReabertura.set(false);
        this.reabrindoChamado.set(false);
        this.reaberturaTexto = '';
        this.triggerToast('Chamado reaberto e sincronizado com o Kanban!', 'success');
        
        // Atualiza a ocorrência selecionada local
        if (res && res.data) {
          this.ocorrenciaSelecionada.set(res.data);
          this.respostaTexto.set('');
        }
        
        // Recarrega a lista geral de ocorrências
        this.carregarOcorrencias();
        // Recarrega as mensagens do chat
        this.carregarMensagensChat(idOcorrencia);
        // Recarrega overview para atualizar contadores
        this.carregar();
      },
      error: (err) => {
        console.error('Erro ao reabrir ocorrência:', err);
        this.enviandoReabertura.set(false);
        this.triggerToast('Erro ao reabrir e sincronizar o chamado.', 'error');
      }
    });
  }


  abrirNovoChamado(): void {
    this.modalNovoChamadoAberto.set(true);
    this.novoChamadoCondominioId.set(null);
    this.novoChamadoDescricao.set('');
  }

  fecharNovoChamado(): void {
    this.modalNovoChamadoAberto.set(false);
    this.novoChamadoCondominioId.set(null);
    this.novoChamadoDescricao.set('');
  }

  enviarNovoChamado(): void {
    const idCondominio = this.novoChamadoCondominioId();
    const descricao = this.novoChamadoDescricao().trim();
    if (!idCondominio || !descricao) {
      this.triggerToast('Por favor, selecione o condomínio e digite a descrição.', 'error');
      return;
    }

    this.criandoNovoChamado.set(true);
    this.api.criarOcorrencia(Number(idCondominio), descricao).subscribe({
      next: () => {
        this.criandoNovoChamado.set(false);
        this.triggerToast('Novo chamado criado e enviado para o Kanban com sucesso!', 'success');
        this.fecharNovoChamado();
        this.carregarOcorrencias(); // Recarrega a lista
        this.carregar(); // Recarrega contadores
      },
      error: (err) => {
        console.error(err);
        this.criandoNovoChamado.set(false);
        this.triggerToast('Erro ao criar o chamado.', 'error');
      }
    });
  }

  confirmarPagamentoManual(idFatura: string): void {
    this.ultimaFaturaPaga.set(idFatura);
    setTimeout(() => {
      if (this.ultimaFaturaPaga() === idFatura) this.ultimaFaturaPaga.set(null);
    }, 1400);

    const fat = this.faturas().find(f => f.id === idFatura);
    if (!fat) return;

    const c = this.clientes().find(cl => cl.id === fat.clienteId);
    if (!c) return;

    // Calculate new vencimento date by adding 30 days to current vencimento
    const currentVenc = c.vencimento ? new Date(c.vencimento) : new Date();
    const nextVenc = new Date(currentVenc);
    nextVenc.setDate(nextVenc.getDate() + 30);
    const nextVencStr = nextVenc.toISOString().split('T')[0];

    // Call API to persist the updated vencimento
    this.api.atualizar(c.id, { vencimento: nextVencStr }).subscribe({
      next: (res) => {
        this.carregar();

        // Registrar no log
        this.pushLog({
          data: new Date().toISOString(),
          origem: 'System',
          evento: 'manual_payment_override',
          status: 'sucesso',
          payload: JSON.stringify({ faturaId: idFatura, valor: fat.valor, condominio: fat.condominio })
        });

        this.triggerToast(`Fatura ${idFatura} liquidada manualmente com sucesso. Novo vencimento: ${nextVenc.toLocaleDateString('pt-BR')}.`, 'success');
      },
      error: (err) => {
        console.error('Erro ao confirmar pagamento manual:', err);
        this.triggerToast(`Não foi possível liquidar a fatura ${idFatura}. Tente novamente.`, 'error');
      }
    });
  }

  reenviarWhatsApp(idFatura: string): void {
    const fat = this.faturas().find(f => f.id === idFatura);
    if (!fat) return;

    const dataAtual = new Date().toISOString();
    this.ultimoDisparoData.set(dataAtual);
    setTimeout(() => {
      if (this.ultimoDisparoData() === dataAtual) this.ultimoDisparoData.set(null);
    }, 1800);

    const c = this.clientes().find(cl => cl.id === fat.clienteId);
    const telefone = c?.contatoPrincipal?.telefone ?? '(11) 99999-8888';

    this.historicoDisparos.update(disp => [
      {
        data: dataAtual,
        condominio: fat.condominio,
        tipo: fat.status === 'vencida' ? 'Cobrança atrasada' : 'Aviso prévio',
        status: 'entregue',
        telefone,
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

  abrirDetalheCard(tipo: 'emitido' | 'recebido' | 'pendente' | 'inadimplencia'): void {
    this.selectedKpiCard.set(tipo);
  }

  fecharDetalheCard(): void {
    this.selectedKpiCard.set(null);
  }

  abrirFaturaDetalhada(f: Fatura): void {
    this.faturaDetalhada.set(f);
  }

  fecharFaturaDetalhada(): void {
    this.faturaDetalhada.set(null);
  }

  abrirCobrarWhats(f: Fatura): void {
    this.whatsCobrancaFatura.set(f);
    const c = this.clientes().find(cl => cl.id === f.clienteId);
    const sindico = c?.contatoPrincipal?.nome ?? 'Síndico';
    const tel = c?.contatoPrincipal?.telefone ?? '';
    this.whatsTelefoneDestinatario.set(tel);

    // Constrói a mensagem personalizada baseada no status
    let baseMsg = '';
    if (f.status === 'vencida') {
      baseMsg = this.configAutomacoes().templatePosVencimento;
    } else if (f.status === 'pendente') {
      baseMsg = this.configAutomacoes().templateVencimento;
    } else {
      baseMsg = 'Olá, *{{sindico}}*!\nSegue a fatura *{{faturaId}}* do *{{condominio}}* no valor de *{{valor}}*.\n\nLink para segunda via: {{link_pagamento}}';
    }

    // Resolve as variáveis
    const data = {
      sindico,
      condominio: f.condominio,
      plano: c?.plano ?? 'Profissional',
      valor: this.moeda(f.valor),
      vencimento: new Date(f.vencimento).toLocaleDateString('pt-BR'),
      dias: String(c?.diasParaVencer != null ? Math.abs(c.diasParaVencer) : 0),
      copia_cola: '00020126360014br.gov.bcb.pix0114+5511999998888',
      link_pagamento: `clickprestare.com.br/faturas/${f.id}`,
      faturaId: f.id
    };

    const resolvida = baseMsg.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
      data[k as keyof typeof data] !== undefined ? data[k as keyof typeof data] : m
    );

    this.whatsMensagemRascunho.set(resolvida);
  }

  confirmarEnvioWhats(): void {
    const f = this.whatsCobrancaFatura();
    if (!f) return;

    const tel = this.whatsTelefoneDestinatario().replace(/\D/g, '');
    const num = tel.length <= 11 ? '55' + tel : tel;
    const msg = this.whatsMensagemRascunho();

    const dataAtual = new Date().toISOString();
    this.ultimoDisparoData.set(dataAtual);
    setTimeout(() => {
      if (this.ultimoDisparoData() === dataAtual) this.ultimoDisparoData.set(null);
    }, 1800);

    // Registra nos disparos
    this.historicoDisparos.update(disp => [
      {
        data: dataAtual,
        condominio: f.condominio,
        tipo: 'Cobrança manual WhatsApp',
        status: 'entregue',
        telefone: this.whatsTelefoneDestinatario(),
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
      payload: JSON.stringify({ faturaId: f.id, destinatario: f.condominio, mensagem: msg })
    });

    // Abre em nova aba
    const link = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
    window.open(link, '_blank');

    this.triggerToast(`Notificação enviada com sucesso para o condomínio ${f.condominio}.`, 'success');
    this.whatsCobrancaFatura.set(null);
  }

  abrirBaixaManual(f: Fatura): void {
    this.baixaManualFatura.set(f);
    this.baixaMetodo.set(f.metodoPagamento === 'Boleto' ? 'Boleto' : 'Pix');
    const hoje = new Date();
    const dataStr = hoje.toISOString().split('T')[0];
    const horaStr = hoje.toTimeString().split(' ')[0].substring(0, 5);
    this.baixaData.set(dataStr);
    this.baixaHora.set(horaStr);
    this.baixaValor.set(f.valor);
    this.baixaObservacoes.set('');
  }

  executarBaixaManualPersonalizada(): void {
    const f = this.baixaManualFatura();
    if (!f) return;

    const c = this.clientes().find(cl => cl.id === f.clienteId);
    if (!c) return;

    const dataPagamentoCustom = `${this.baixaData()}T${this.baixaHora()}:00.000Z`;

    // Atualiza vencimento no backend
    const currentVenc = c.vencimento ? new Date(c.vencimento) : new Date();
    const nextVenc = new Date(currentVenc);
    nextVenc.setDate(nextVenc.getDate() + 30);
    const nextVencStr = nextVenc.toISOString().split('T')[0];

    this.salvando.set(true);
    this.api.atualizar(c.id, { vencimento: nextVencStr }).subscribe({
      next: (res) => {
        this.salvando.set(false);
        this.carregar();

        // Salva metadados da baixa manual no estado reativo
        this.manualPaymentsMetadata.update(map => ({
          ...map,
          [f.id]: {
            metodo: this.baixaMetodo(),
            dataPagamento: dataPagamentoCustom,
            valorPago: this.baixaValor(),
            obs: this.baixaObservacoes()
          }
        }));

        // Registra no log
        this.pushLog({
          data: new Date().toISOString(),
          origem: 'System',
          evento: 'manual_payment_override',
          status: 'sucesso',
          payload: JSON.stringify({
            faturaId: f.id,
            valorPago: this.baixaValor(),
            metodo: this.baixaMetodo(),
            dataPagamento: dataPagamentoCustom,
            obs: this.baixaObservacoes()
          })
        });

        this.triggerToast(`Fatura ${f.id} baixada manualmente com sucesso. Novo vencimento: ${nextVenc.toLocaleDateString('pt-BR')}.`, 'success');
        this.baixaManualFatura.set(null);
        
        // Se ela estava aberta no modal de detalhe, fecha ou atualiza. Vamos fechar por conveniência
        if (this.faturaDetalhada()?.id === f.id) {
          this.faturaDetalhada.set(null);
        }
      },
      error: (err) => {
        console.error('Erro ao efetuar baixa manual:', err);
        this.salvando.set(false);
        this.triggerToast(`Erro ao liquidar a fatura ${f.id}.`, 'error');
      }
    });
  }

  findCliente(id: number): CrmCliente | undefined {
    return this.clientes().find(c => c.id === id);
  }

  /** Link de WhatsApp (wa.me) pré-preenchido com contexto de cobrança. Null se não há telefone. */
  waLink(cliente: CrmCliente): string | null {
    const tel = (cliente.contatoPrincipal?.telefone || '').replace(/\D/g, '');
    if (!tel) return null;
    const num = tel.length <= 11 ? '55' + tel : tel;
    const venc =
      cliente.diasParaVencer != null && cliente.diasParaVencer < 0
        ? `está vencida há ${Math.abs(cliente.diasParaVencer)} dia(s)`
        : 'está próxima do vencimento';
    const msg = `Olá! Aqui é da Click Prestare. A assinatura do ${cliente.nome} (${this.moeda(
      cliente.mrr,
    )}/mês) ${venc}. Podemos ajudar a regularizar?`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }

  gerarRelatorio(): void {
    this.gerandoRelatorio.set(true);
    setTimeout(() => {
      this.relatorioGerado.set(true);
      this.gerandoRelatorio.set(false);
      this.triggerToast('Visualização do relatório atualizada.', 'success');
    }, 600);
  }

  exportarCSV(tipo: string): void {
    let csvContent = '\uFEFF'; // BOM para suporte UTF-8 no Excel
    let filename = `relatorio_${tipo}_${new Date().toISOString().split('T')[0]}.csv`;
    
    if (tipo === 'financeiro') {
      csvContent += 'Condomínio;Plano;Mensalidade (MRR);Status de Cobrança;Dias para Vencer;Saúde Financeira\n';
      for (const c of this.clientes()) {
        csvContent += `"${c.nome}";"${c.plano || 'Sem plano'}";"${c.mrr}";"${c.statusPagamento}";"${c.diasParaVencer ?? '—'}";"${this.pagamentoLabel(c.statusPagamento)}"\n`;
      }
    } else if (tipo === 'clientes') {
      csvContent += 'Condomínio;Estágio;Cidade;UF;Plano;Health Score;Dias para Vencer\n';
      for (const c of this.clientes()) {
        csvContent += `"${c.nome}";"${c.estagio}";"${c.cidade || '—'}";"${c.uf || '—'}";"${c.plano || 'Sem plano'}";${c.healthScore};"${c.diasParaVencer ?? '—'}"\n`;
      }
    } else if (tipo === 'portaria') {
      csvContent += 'Condomínio;Apartamentos;Moradores;Cadastros Faciais;Adoção RFID (Tags);Terminais Faciais;Dispositivos Offline\n';
      for (const c of this.clientes()) {
        csvContent += `"${c.nome}";${c.totalApartamentos};${c.totalMoradores};${c.moradoresComFace};${c.moradoresComTag};${c.dispositivosFaciais};${c.dispositivosOffline}\n`;
      }
    } else if (tipo === 'notificacoes') {
      csvContent += 'Data;Condomínio;Tipo de Disparo;Status;Telefone/WhatsApp;Erro\n';
      for (const d of this.historicoDisparos()) {
        csvContent += `"${d.data}";"${d.condominio}";"${d.tipo}";"${d.status}";"${d.telefone}";"${d.erroMsg || 'Nenhum'}"\n`;
      }
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      this.triggerToast(`Relatório CSV baixado com sucesso: ${filename}`, 'success');
    }
  }

  exportarPDF(tipo: string): void {
    this.triggerToast('Gerando visualização PDF do relatório...', 'info');
    setTimeout(() => {
      window.print();
    }, 500);
  }
}
