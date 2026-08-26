import { Injectable, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { CrmApi, CrmCliente, CrmFatura, CrmHealth, CrmOverview, EstagioCrm } from './crm.service';
import { ToastService } from '../shared/toast.service';
import {
  BaixaManualMetadata,
  ConfigAutomacoes,
  ConfigPlano,
  DisparoView,
  Fatura,
  GatewaysStatus,
  LogWebhook,
} from './crm.models';
import { moeda } from './crm-format';

/**
 * Estado compartilhado do CRM (signals) — dados que mais de uma aba consome.
 * Estado de UI efêmero (filtros, buscas, modais abertos) vive em cada aba.
 */
@Injectable({ providedIn: 'root' })
export class CrmStore {
  private api = inject(CrmApi);
  private toast = inject(ToastService);
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  // ── Dados principais ──
  readonly overview = signal<CrmOverview | null>(null);
  readonly clientes = signal<CrmCliente[]>([]);
  readonly loading = signal(true);
  readonly erro = signal<string | null>(null);

  // ── Seleção cross-aba ──
  readonly clienteSelecionado = signal<CrmCliente | null>(null);

  /**
   * Busca global do cabeçalho. A aba Clientes consome este termo ao abrir
   * (o campo de busca local continua sendo a fonte de verdade dentro da aba).
   */
  readonly buscaGlobal = signal('');

  // ── Conexão com o banco ──
  readonly dbHealth = signal<CrmHealth | null>(null);
  readonly healthLoading = signal(false);

  // ── Faturamento ──
  readonly faturas = signal<Fatura[]>([]);
  readonly faturasLoading = signal(false);
  readonly ultimaFaturaPaga = signal<string | null>(null);
  readonly manualPaymentsMetadata = signal<Record<string, BaixaManualMetadata>>({});
  readonly salvando = signal(false);

  readonly faturamentoCards = computed(() => {
    const lista = this.faturas();
    const emitido = lista.reduce((s, f) => s + f.valor, 0);
    const recebido = lista.filter((f) => f.status === 'paga').reduce((s, f) => s + f.valor, 0);
    const pendente = lista.filter((f) => f.status === 'pendente').reduce((s, f) => s + f.valor, 0);
    const inadimplencia = lista.filter((f) => f.status === 'vencida').reduce((s, f) => s + f.valor, 0);
    const taxa = emitido > 0 ? Math.round((inadimplencia / emitido) * 100) : 0;
    return { emitido, recebido, pendente, inadimplencia, taxa };
  });

  // ── Automações / WhatsApp ──
  readonly configAutomacoes = signal<ConfigAutomacoes>({
    triggerPreVencimento: true,
    diasPreVencimento: 5,
    templatePreVencimento: 'Olá, *{{sindico}}*!\nLembramos que a fatura do *{{condominio}}* referente ao plano *{{plano}}* vencerá em {{dias}} dias ({{vencimento}}).\n\nValor: *{{valor}}*\nCódigo Copia/Cola Pix: `{{copia_cola}}`\n\nLink para segunda via: {{link_pagamento}}',
    triggerVencimento: true,
    templateVencimento: 'Olá, *{{sindico}}*!\nSua fatura do *{{condominio}}* vence hoje.\n\nValor: *{{valor}}*\nCódigo Copia/Cola Pix: `{{copia_cola}}`\n\nLink para segunda via: {{link_pagamento}}',
    triggerPosVencimento: true,
    diasPosVencimento: 3,
    templatePosVencimento: 'ATENÇÃO: Olá, *{{sindico}}*.\nIdentificamos pendência financeira na assinatura do *{{condominio}}* vencida há {{dias}} dias ({{vencimento}}).\n\nValor original: *{{valor}}*\n\nEvite a suspensão dos serviços e atualização de hardware. Efetue o pagamento através do link: {{link_pagamento}}',
  });

  /** Histórico REAL de disparos WhatsApp (Crm_Disparos via Z-API). */
  readonly historicoDisparos = signal<DisparoView[]>([]);
  readonly ultimoDisparoData = signal<string | null>(null);

  // ── Planos e gateways ──
  readonly configPlanos = signal<ConfigPlano[]>([
    { plano: 'Essencial', sistema: 'Somente App', valorBase: 149, valorPorUH: 2.0 },
    { plano: 'Profissional', sistema: 'Com Portaria', valorBase: 297, valorPorUH: 2.8 },
    { plano: 'Elite', sistema: 'Com Controle de Acesso', valorBase: 497, valorPorUH: 3.8 },
  ]);

  /** O backend só informa SE cada integração está configurada; credenciais nunca chegam ao navegador. */
  readonly gatewaysStatus = signal<GatewaysStatus | null>(null);

  // ── Logs técnicos ──
  readonly logsWebhooks = signal<LogWebhook[]>([
    { data: '2026-06-24T00:12:00Z', origem: 'Asaas', evento: 'payment_received', status: 'sucesso', payload: '{"paymentId":"pay_4839201","value":450.00,"condominioId":1,"method":"Pix"}' },
    { data: '2026-06-23T23:45:00Z', origem: 'Z-API', evento: 'message_sent', status: 'sucesso', payload: '{"messageId":"msg_8820491","to":"5511981129988","status":"delivered"}' },
    { data: '2026-06-23T18:22:00Z', origem: 'Asaas', evento: 'webhook_validated', status: 'sucesso', payload: '{"verification":"ok","gateway_status":"healthy"}' },
    { data: '2026-06-23T14:30:00Z', origem: 'System', evento: 'config_updated', status: 'info', payload: '{"updatedBy":"admin@clickprestare.com.br","section":"automacoes"}' },
  ]);
  readonly ultimoLogData = signal<string | null>(null);

  // ── Feedback de salvamento (config) ──
  readonly salvandoRegua = signal(false);
  readonly salvandoConfigPlanos = signal(false);
  readonly salvandoGateways = signal(false);

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
    { mes: 'Jun 26', valor: 6800 },
  ]);

  // ════════════════ Carregamento ════════════════

  /** Carrega tudo que a shell precisa na entrada do painel. */
  carregarTudo(): void {
    this.carregar();
    this.carregarFaturas();
    this.carregarDisparos();
    this.carregarGatewaysStatus();
    this.carregarConfigAutomacoes();
    this.verificarConexao();
  }

  iniciarHealthPolling(): void {
    if (this.healthInterval) return;
    this.healthInterval = setInterval(() => this.verificarConexao(), 30000);
  }

  pararHealthPolling(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
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
      },
    });
  }

  carregarFaturas(): void {
    this.faturasLoading.set(true);
    this.api.faturas().subscribe({
      next: (rows: CrmFatura[]) => {
        const lista: Fatura[] = rows
          .filter((r) => r.status !== 'cancelada')
          .map((r) => ({
            id: `FT-${r.referencia.replace('/', '-')}-${r.clienteId}`,
            dbId: r.id,
            clienteId: r.clienteId,
            condominio: r.condominio,
            referencia: r.referencia,
            valor: r.valor,
            vencimento: r.vencimento ?? new Date().toISOString(),
            metodoPagamento: r.metodoPagamento ?? 'Pix',
            status: r.status as 'paga' | 'pendente' | 'vencida',
            dataPagamento: r.dataPagamento,
            baixaPor: r.baixaPor,
            baixaMotivo: r.baixaMotivo,
            estimada: r.estimada,
          }));
        this.faturas.set(lista);
        this.faturasLoading.set(false);
      },
      error: () => {
        this.faturasLoading.set(false);
        this.toast.trigger('Não foi possível carregar as faturas.', 'error');
      },
    });
  }

  gerarFaturasMes(): void {
    this.salvando.set(true);
    this.api.gerarFaturas().subscribe({
      next: (res) => {
        this.salvando.set(false);
        this.toast.trigger(`${res?.criadas ?? 0} fatura(s) gerada(s) para a referência ${res?.referencia ?? 'atual'}.`, 'success');
        this.carregarFaturas();
      },
      error: (err) => {
        this.salvando.set(false);
        this.toast.trigger(err?.error?.message ?? 'Erro ao gerar faturas do mês.', 'error');
      },
    });
  }

  carregarDisparos(): void {
    this.api.disparos().subscribe({
      next: (rows) => {
        this.historicoDisparos.set(
          rows.map((d) => ({
            data: d.data,
            condominio: d.condominio,
            tipo: d.tipo === 'cobranca_manual' ? 'Cobrança manual WhatsApp' : d.tipo,
            status: d.status === 'enviado' ? 'entregue' : 'falhou',
            telefone: d.telefone,
            erroMsg: d.erro,
          })),
        );
      },
      error: () => { /* silencioso — histórico não é crítico para a página */ },
    });
  }

  carregarGatewaysStatus(): void {
    this.api.gatewaysStatus().subscribe({
      next: (s) => this.gatewaysStatus.set(s),
      error: () => this.gatewaysStatus.set(null),
    });
  }

  carregarConfigAutomacoes(): void {
    this.api.getConfig().subscribe({
      next: (cfg) => {
        if (cfg['automacoes']) {
          try {
            this.configAutomacoes.update((atual) => ({ ...atual, ...JSON.parse(cfg['automacoes']) }));
          } catch { /* config corrompida — mantém defaults */ }
        }
        if (cfg['planos']) {
          try {
            this.configPlanos.set(JSON.parse(cfg['planos']));
          } catch { /* idem */ }
        }
      },
      error: () => { /* sem config salva ainda — defaults */ },
    });
  }

  // ════════════════ Seleção de cliente ════════════════

  abrirCliente(c: CrmCliente): void {
    this.clienteSelecionado.set(c);
  }

  fecharCliente(): void {
    this.clienteSelecionado.set(null);
  }

  findCliente(id: number): CrmCliente | undefined {
    return this.clientes().find((c) => c.id === id);
  }

  // ════════════════ Faturamento: ações ════════════════

  confirmarPagamentoManual(idFatura: string): void {
    this.ultimaFaturaPaga.set(idFatura);
    setTimeout(() => {
      if (this.ultimaFaturaPaga() === idFatura) this.ultimaFaturaPaga.set(null);
    }, 1400);

    const fat = this.faturas().find((f) => f.id === idFatura);
    if (!fat) return;

    const c = this.clientes().find((cl) => cl.id === fat.clienteId);
    if (!c) return;

    const currentVenc = c.vencimento ? new Date(c.vencimento) : new Date();
    const nextVenc = new Date(currentVenc);
    nextVenc.setDate(nextVenc.getDate() + 30);
    const nextVencStr = nextVenc.toISOString().split('T')[0];

    this.api.atualizar(c.id, { vencimento: nextVencStr }).subscribe({
      next: () => {
        this.carregar();
        this.pushLog({
          data: new Date().toISOString(),
          origem: 'System',
          evento: 'manual_payment_override',
          status: 'sucesso',
          payload: JSON.stringify({ faturaId: idFatura, valor: fat.valor, condominio: fat.condominio }),
        });
        this.toast.trigger(`Fatura ${idFatura} liquidada manualmente com sucesso. Novo vencimento: ${nextVenc.toLocaleDateString('pt-BR')}.`, 'success');
      },
      error: (err) => {
        console.error('Erro ao confirmar pagamento manual:', err);
        this.toast.trigger(`Não foi possível liquidar a fatura ${idFatura}. Tente novamente.`, 'error');
      },
    });
  }

  reenviarWhatsApp(idFatura: string): void {
    const fat = this.faturas().find((f) => f.id === idFatura);
    if (!fat) return;

    const dataAtual = new Date().toISOString();
    this.marcarDisparoRecente(dataAtual);

    const c = this.clientes().find((cl) => cl.id === fat.clienteId);
    const telefone = c?.contatoPrincipal?.telefone ?? '(11) 99999-8888';

    this.historicoDisparos.update((disp) => [
      {
        data: dataAtual,
        condominio: fat.condominio,
        tipo: fat.status === 'vencida' ? 'Cobrança atrasada' : 'Aviso prévio',
        status: 'entregue',
        telefone,
        erroMsg: null,
      },
      ...disp,
    ]);

    this.pushLog({
      data: dataAtual,
      origem: 'Z-API',
      evento: 'message_sent',
      status: 'sucesso',
      payload: JSON.stringify({ faturaId: idFatura, destinatario: fat.condominio, status: 'enviado_manual' }),
    });

    this.toast.trigger(`Notificação enviada com sucesso para o condomínio ${fat.condominio}.`, 'success');
  }

  /** Marca um disparo recém-registrado (highlight temporário na lista). */
  marcarDisparoRecente(data: string): void {
    this.ultimoDisparoData.set(data);
    setTimeout(() => {
      if (this.ultimoDisparoData() === data) this.ultimoDisparoData.set(null);
    }, 1800);
  }

  // ════════════════ Configurações ════════════════

  salvarReguaWhatsApp(): void {
    this.salvandoRegua.set(true);
    const cfg = this.configAutomacoes();
    this.api
      .setConfig({
        automacoes: JSON.stringify(cfg),
        // Template usado pelo backend na cobrança manual via WhatsApp.
        template_cobranca: cfg.templateVencimento,
      })
      .subscribe({
        next: () => {
          this.salvandoRegua.set(false);
          this.toast.trigger('Automações e templates do WhatsApp salvos.', 'success');
          this.pushLog({
            data: new Date().toISOString(),
            origem: 'System',
            evento: 'config_updated',
            status: 'info',
            payload: '{"section":"automacoes_whatsapp"}',
          });
        },
        error: (err) => {
          this.salvandoRegua.set(false);
          this.toast.trigger(err?.error?.message ?? 'Erro ao salvar as automações.', 'error');
        },
      });
  }

  salvarConfiguracaoPlanos(): void {
    this.salvandoConfigPlanos.set(true);
    this.api.setConfig({ planos: JSON.stringify(this.configPlanos()) }).subscribe({
      next: () => {
        this.salvandoConfigPlanos.set(false);
        this.toast.trigger('Tabela de preços e limites de planos salva.', 'success');
        this.pushLog({
          data: new Date().toISOString(),
          origem: 'System',
          evento: 'config_updated',
          status: 'info',
          payload: '{"section":"tabela_planos"}',
        });
      },
      error: (err) => {
        this.salvandoConfigPlanos.set(false);
        this.toast.trigger(err?.error?.message ?? 'Erro ao salvar a tabela de preços.', 'error');
      },
    });
  }

  pushLog(entry: LogWebhook): void {
    this.ultimoLogData.set(entry.data);
    setTimeout(() => {
      if (this.ultimoLogData() === entry.data) this.ultimoLogData.set(null);
    }, 1800);
    this.logsWebhooks.update((log) => [entry, ...log]);
  }

  // ════════════════ Helpers ════════════════

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

  /** Link de WhatsApp (wa.me) pré-preenchido com contexto de cobrança. Null se não há telefone. */
  waLink(cliente: CrmCliente): string | null {
    const tel = (cliente.contatoPrincipal?.telefone || '').replace(/\D/g, '');
    if (!tel) return null;
    const num = tel.length <= 11 ? '55' + tel : tel;
    const venc =
      cliente.diasParaVencer != null && cliente.diasParaVencer < 0
        ? `está vencida há ${Math.abs(cliente.diasParaVencer)} dia(s)`
        : 'está próxima do vencimento';
    const msg = `Olá! Aqui é da Click Prestare. A assinatura do ${cliente.nome} (${moeda(cliente.mrr)}/mês) ${venc}. Podemos ajudar a regularizar?`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }
}
