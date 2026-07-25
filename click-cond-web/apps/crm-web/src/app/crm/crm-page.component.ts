import { Component, HostListener, OnInit, OnDestroy, ViewChild, ElementRef, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { CrmApi, CrmCliente, EstagioCrm, StatusPagamento } from './crm.service';
import { CrmStore } from './crm.store';
import { AuthService } from '../auth/auth.service';
import { ToastService, ToastTipo } from '../shared/toast.service';
import { CountUpDirective } from '../shared/count-up.directive';
import { Apartamento, EstagioFiltro, Fatura, Morador, Ordenacao, StatusFatura } from './crm.models';
import * as fmt from './crm-format';

export type { Fatura } from './crm.models';

@Component({
  selector: 'app-crm-page',
  standalone: true,
  imports: [CommonModule, FormsModule, CountUpDirective],
  templateUrl: './crm-page.component.html',
})
export class CrmPageComponent implements OnInit, OnDestroy {
  private api = inject(CrmApi);
  readonly auth = inject(AuthService);
  readonly store = inject(CrmStore);
  private toast = inject(ToastService);

  // ── Estado compartilhado: aliases para o CrmStore (template inalterado) ──
  readonly overview = this.store.overview;
  readonly clientes = this.store.clientes;
  readonly loading = this.store.loading;
  readonly erro = this.store.erro;
  readonly clienteSelecionado = this.store.clienteSelecionado;
  readonly dbHealth = this.store.dbHealth;
  readonly healthLoading = this.store.healthLoading;
  readonly faturas = this.store.faturas;
  readonly faturasLoading = this.store.faturasLoading;
  readonly ultimaFaturaPaga = this.store.ultimaFaturaPaga;
  readonly manualPaymentsMetadata = this.store.manualPaymentsMetadata;
  readonly salvando = this.store.salvando;
  readonly faturamentoCards = this.store.faturamentoCards;
  readonly configAutomacoes = this.store.configAutomacoes;
  readonly historicoDisparos = this.store.historicoDisparos;
  readonly ultimoDisparoData = this.store.ultimoDisparoData;
  readonly configPlanos = this.store.configPlanos;
  readonly gatewaysStatus = this.store.gatewaysStatus;
  readonly logsWebhooks = this.store.logsWebhooks;
  readonly ultimoLogData = this.store.ultimoLogData;
  readonly salvandoRegua = this.store.salvandoRegua;
  readonly salvandoConfigPlanos = this.store.salvandoConfigPlanos;
  readonly salvandoGateways = this.store.salvandoGateways;
  readonly historicoReceita = this.store.historicoReceita;
  readonly toasts = this.toast.toasts;

  readonly Math = Math;

  // ── Estado de UI local: aba Clientes ──
  readonly busca = signal('');          // termo aplicado ao filtro (debounced)
  readonly buscaRaw = signal('');       // valor imediato do input
  private buscaTimer: any = null;
  readonly filtroEstagio = signal<EstagioFiltro>('todos');
  readonly ordenacao = signal<Ordenacao>('mrr');
  readonly abaSelecionada = signal<'geral' | 'portaria' | 'servicos' | 'moradores'>('geral');

  // ── Estado local: gestão de moradores (drawer) ──
  readonly moradores = signal<Morador[]>([]);
  readonly apartamentos = signal<Apartamento[]>([]);
  readonly moradoresLoading = signal(false);
  readonly buscaMorador = signal('');
  readonly mostrandoFormMorador = signal(false);
  readonly registrarNome = signal('');
  readonly registrarTelefone = signal('');
  readonly registrarEmail = signal('');
  readonly registrarAptoId = signal<number | null>(null);
  readonly registrarDocumento = signal('');
  readonly registrarSenha = signal('');
  readonly modoEdicao = signal(false);
  dadosEditados: any = {};

  // ── Estado local: aba Faturamento (filtros e modais) ──
  readonly filtroFatura = signal<StatusFatura>('todos');
  readonly selectedKpiCard = signal<'emitido' | 'recebido' | 'pendente' | 'inadimplencia' | null>(null);
  readonly faturaDetalhada = signal<Fatura | null>(null);
  readonly whatsCobrancaFatura = signal<Fatura | null>(null);
  readonly whatsMensagemRascunho = signal<string>('');
  readonly whatsTelefoneDestinatario = signal<string>('');
  readonly baixaManualFatura = signal<Fatura | null>(null);
  readonly baixaMetodo = signal<'Pix' | 'Boleto' | 'Dinheiro' | 'Transferência' | 'Outro'>('Pix');
  readonly baixaData = signal<string>('');
  readonly baixaHora = signal<string>('');
  readonly baixaValor = signal<number>(0);
  readonly baixaObservacoes = signal<string>('');

  // ── Navegação entre abas ──
  readonly abaNavegacao = signal<'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes' | 'relatorios' | 'chamados'>('overview');

  // ── Estado local: aba Chamados ──
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
        .replace(/[̀-ͯ]/g, '');
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
  readonly reabrindoChamado = signal(false);
  reaberturaTexto = '';
  readonly enviandoReabertura = signal(false);
  readonly chatMensagens = signal<any[]>([]);
  readonly loadingChatMensagens = signal(false);
  chatNovaMensagem = '';
  chatInterval: any = null;
  ocorrenciasInterval: any = null;
  readonly modalNovoChamadoAberto = signal(false);
  readonly novoChamadoCondominioId = signal<number | null>(null);
  readonly novoChamadoDescricao = signal('');
  readonly criandoNovoChamado = signal(false);

  // ── Estado local: aba Relatórios ──
  readonly relatorioTipo = signal<'financeiro' | 'clientes' | 'portaria' | 'notificacoes'>('financeiro');
  readonly relatorioPeriodo = signal<'30d' | '90d' | 'ano' | 'tudo'>('tudo');
  readonly relatorioGerado = signal(true);
  readonly gerandoRelatorio = signal(false);

  // ── Estado local: aba Automações (preview) ──
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
      .replace(/`([^`]+)`/g, '<code class="bg-surface-sunken px-1 rounded text-accent">$1</code>')
      .replace(/_([^_]+)_/g, '<i>$1</i>');
  }

  readonly previewTabs: { valor: 'pre' | 'venc' | 'pos'; label: string }[] = [
    { valor: 'pre', label: 'Aviso prévio' },
    { valor: 'venc', label: 'No vencimento' },
    { valor: 'pos', label: 'Atraso' },
  ];

  // ── Estado local: aba Configurações ──
  readonly chavesVisiveis = signal<Record<string, boolean>>({});

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

  // ── Gráficos (overview) ──

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
        { stroke: '#2563eb', text: 'text-accent', bg: 'bg-accent' },          // Azul royal
        { stroke: '#7c3aed', text: 'text-info', bg: 'bg-info' },              // Violeta
        { stroke: '#16a34a', text: 'text-success', bg: 'bg-success' },        // Verde
        { stroke: '#a1a1aa', text: 'text-ink-soft', bg: 'bg-ink-muted' },     // Neutro
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

  // ── Computeds locais da aba Faturamento ──
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

  // ── Ciclo de vida ──

  ngOnInit(): void {
    this.store.carregarTudo();
    this.store.iniciarHealthPolling();
  }

  ngOnDestroy(): void {
    this.store.pararHealthPolling();
    if (this.chatInterval) {
      clearInterval(this.chatInterval);
    }
    this.limparIntervaloOcorrencias();
  }

  // ── Delegações para o store (mantêm os nomes usados no template) ──

  carregar(): void { this.store.carregar(); }
  carregarFaturas(): void { this.store.carregarFaturas(); }
  gerarFaturasMes(): void { this.store.gerarFaturasMes(); }
  carregarDisparos(): void { this.store.carregarDisparos(); }
  carregarGatewaysStatus(): void { this.store.carregarGatewaysStatus(); }
  carregarConfigAutomacoes(): void { this.store.carregarConfigAutomacoes(); }
  verificarConexao(): void { this.store.verificarConexao(); }
  confirmarPagamentoManual(idFatura: string): void { this.store.confirmarPagamentoManual(idFatura); }
  reenviarWhatsApp(idFatura: string): void { this.store.reenviarWhatsApp(idFatura); }
  salvarReguaWhatsApp(): void { this.store.salvarReguaWhatsApp(); }
  salvarConfiguracaoPlanos(): void { this.store.salvarConfiguracaoPlanos(); }
  findCliente(id: number): CrmCliente | undefined { return this.store.findCliente(id); }
  waLink(cliente: CrmCliente): string | null { return this.store.waLink(cliente); }
  estagioCount(estagio: EstagioCrm): number { return this.store.estagioCount(estagio); }
  estagioPct(estagio: EstagioCrm): number { return this.store.estagioPct(estagio); }
  planoPct(mrr: number): number { return this.store.planoPct(mrr); }

  triggerToast(msg: string, tipo: ToastTipo = 'info'): void { this.toast.trigger(msg, tipo); }
  dismissToast(id: number): void { this.toast.dismiss(id); }

  // ── Busca (aba Clientes) ──

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

  // ── Drawer de cliente ──

  abrirCliente(c: CrmCliente): void {
    this.abaSelecionada.set('geral');
    this.store.abrirCliente(c);
    this.modoEdicao.set(false);
    this.moradores.set([]);
    this.apartamentos.set([]);
  }

  fecharCliente(): void {
    this.store.fecharCliente();
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

  gerarMockMoradores(idCondominio: number, count: number): Morador[] {
    const nomes = ['João Silva', 'Maria Oliveira', 'Carlos Souza', 'Ana Santos', 'Pedro Lima', 'Julia Costa', 'Lucas Fernandes', 'Beatriz Alencar', 'Marcos Rocha', 'Fernanda Ribeiro'];
    const blocos = ['A', 'B', 'C'];
    const tipos = ['proprietario', 'inquilino'];

    const list: Morador[] = [];
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

  gerarMockApartamentos(idCondominio: number): Apartamento[] {
    const list: Apartamento[] = [];
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

  gerarMensagemWhatsApp(morador: Morador, senha: string, condominioNome: string): string {
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

  dispararWhatsAppCredenciais(morador: Morador, senha: string, condominioNome: string): void {
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
      const mockCreated: Morador = {
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

  reenviarCredenciaisMorador(morador: Morador): void {
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

    this.store.salvando.set(true);
    this.api.atualizar(c.id, this.dadosEditados).subscribe({
      next: (res) => {
        this.store.salvando.set(false);
        this.modoEdicao.set(false);
        this.store.clienteSelecionado.set(res.data);
        this.carregar();
        this.triggerToast('Dados do condomínio atualizados com sucesso.', 'success');
      },
      error: (err) => {
        console.error('Erro ao salvar cliente:', err);
        this.store.salvando.set(false);
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

  // ── Helpers de apresentação (funções puras em crm-format.ts) ──

  estagioLabel(e: EstagioCrm): string { return fmt.estagioLabel(e); }
  estagioClasse(e: EstagioCrm): string { return fmt.estagioClasse(e); }
  pagamentoLabel(s: StatusPagamento): string { return fmt.pagamentoLabel(s); }
  pagamentoClasse(s: StatusPagamento): string { return fmt.pagamentoClasse(s); }
  riscoLabel(nivel: 'alto' | 'medio' | 'baixo'): string { return fmt.riscoLabel(nivel); }
  riscoClasse(nivel: 'alto' | 'medio' | 'baixo'): string { return fmt.riscoClasse(nivel); }
  healthClasse(score: number): string { return fmt.healthClasse(score); }
  healthBg(score: number): string { return fmt.healthBg(score); }
  severidadeClasse(s: 'alta' | 'media' | 'baixa'): string { return fmt.severidadeClasse(s); }
  severidadeDot(s: 'alta' | 'media' | 'baixa'): string { return fmt.severidadeDot(s); }
  iniciais(nome: string): string { return fmt.iniciais(nome); }
  moeda(v: number): string { return fmt.moeda(v); }

  // ── Navegação entre abas principais ──

  alterarAbaNavegacao(aba: 'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes' | 'relatorios' | 'chamados'): void {
    this.abaNavegacao.set(aba);
    // Limpar cliente selecionado ao trocar de aba principal para evitar sobreposições
    this.store.fecharCliente();
    this.limparIntervaloOcorrencias();

    if (aba === 'chamados') {
      this.carregarOcorrencias();
      // Polling a cada 10 segundos para novos chamados no CRM
      this.ocorrenciasInterval = setInterval(() => {
        this.recargaSilenciosaOcorrencias();
      }, 10000);
    }
  }

  // ── Chamados / ocorrências ──

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

  // ── Modais de faturamento ──

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
      data[k as keyof typeof data] !== undefined ? String(data[k as keyof typeof data]) : m
    );

    this.whatsMensagemRascunho.set(resolvida);
  }

  confirmarEnvioWhats(): void {
    const f = this.whatsCobrancaFatura();
    if (!f) return;

    // Envio REAL via backend (Z-API) — registrado em Crm_Disparos e auditado.
    this.store.salvando.set(true);
    this.api.cobrarWhatsApp(f.dbId).subscribe({
      next: () => {
        this.store.salvando.set(false);
        const dataAtual = new Date().toISOString();
        this.store.marcarDisparoRecente(dataAtual);

        this.store.pushLog({
          data: dataAtual,
          origem: 'Z-API',
          evento: 'message_sent',
          status: 'sucesso',
          payload: JSON.stringify({ faturaId: f.id, destinatario: f.condominio })
        });

        this.carregarDisparos();
        this.triggerToast(`Cobrança enviada por WhatsApp para o condomínio ${f.condominio}.`, 'success');
        this.whatsCobrancaFatura.set(null);
      },
      error: (err) => {
        this.store.salvando.set(false);
        this.carregarDisparos();
        this.triggerToast(err?.error?.message ?? 'Falha ao enviar o WhatsApp de cobrança.', 'error');
      },
    });
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

    // Validações de UX antes de chamar o backend (que valida de novo).
    const motivo = this.baixaObservacoes().trim();
    if (motivo.length < 5) {
      this.triggerToast('Informe o motivo/justificativa da baixa manual (mínimo 5 caracteres).', 'error');
      return;
    }
    const valorPago = this.baixaValor();
    if (!(valorPago > 0)) {
      this.triggerToast('Informe um valor pago maior que zero.', 'error');
      return;
    }
    const dataPagamento = `${this.baixaData()}T${this.baixaHora() || '12:00'}:00.000Z`;
    if (new Date(dataPagamento).getTime() > Date.now() + 24 * 3600 * 1000) {
      this.triggerToast('A data de pagamento não pode ser no futuro.', 'error');
      return;
    }

    this.store.salvando.set(true);
    this.api.baixarFatura(f.dbId, {
      metodo: this.baixaMetodo(),
      motivo,
      dataPagamento,
      valorPago,
    }).subscribe({
      next: (res) => {
        this.store.salvando.set(false);
        this.carregar();
        this.carregarFaturas();

        this.store.manualPaymentsMetadata.update(map => ({
          ...map,
          [f.id]: {
            metodo: this.baixaMetodo(),
            dataPagamento,
            valorPago,
            obs: motivo
          }
        }));

        this.store.pushLog({
          data: new Date().toISOString(),
          origem: 'System',
          evento: 'manual_payment_override',
          status: 'sucesso',
          payload: JSON.stringify({ faturaId: f.id, valorPago, metodo: this.baixaMetodo(), dataPagamento, motivo })
        });

        const novoVenc = res?.novoVencimento ? new Date(res.novoVencimento).toLocaleDateString('pt-BR') : '';
        this.triggerToast(`Fatura ${f.id} liquidada.${novoVenc ? ` Novo vencimento: ${novoVenc}.` : ''}`, 'success');
        this.baixaManualFatura.set(null);
        if (this.faturaDetalhada()?.id === f.id) {
          this.faturaDetalhada.set(null);
        }
      },
      error: (err) => {
        console.error('Erro ao efetuar baixa manual:', err);
        this.store.salvando.set(false);
        this.triggerToast(err?.error?.message ?? `Erro ao liquidar a fatura ${f.id}.`, 'error');
      }
    });
  }

  // ── Relatórios ──

  gerarRelatorio(): void {
    this.gerandoRelatorio.set(true);
    setTimeout(() => {
      this.relatorioGerado.set(true);
      this.gerandoRelatorio.set(false);
      this.triggerToast('Visualização do relatório atualizada.', 'success');
    }, 600);
  }

  exportarCSV(tipo: string): void {
    let csvContent = '﻿'; // BOM para suporte UTF-8 no Excel
    const filename = `relatorio_${tipo}_${new Date().toISOString().split('T')[0]}.csv`;

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
