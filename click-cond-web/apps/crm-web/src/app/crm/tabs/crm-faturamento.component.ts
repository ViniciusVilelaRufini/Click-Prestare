import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmApi } from '../crm.service';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { ModalShellComponent } from '../../shared/ui/modal-shell.component';
import { KpiCardComponent } from '../../shared/ui/kpi-card.component';
import { Fatura, StatusFatura } from '../crm.models';
import { iniciais, moeda } from '../crm-format';

type KpiCard = 'emitido' | 'recebido' | 'pendente' | 'inadimplencia';

/**
 * Aba Faturamento: KPIs de cobrança, histórico de faturas (tabela ≥md, cards
 * <md lendo o mesmo computed) e os quatro fluxos modais — detalhamento por
 * KPI, detalhe da fatura, cobrança por WhatsApp e baixa manual auditada.
 */
@Component({
  selector: 'crm-faturamento',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent, SkeletonComponent, ModalShellComponent, KpiCardComponent],
  templateUrl: './crm-faturamento.component.html',
})
export class CrmFaturamentoComponent {
  private api = inject(CrmApi);
  readonly store = inject(CrmStore);
  private toast = inject(ToastService);

  readonly moeda = moeda;
  readonly iniciais = iniciais;

  /** Paths dos ícones dos KPIs (heroicons outline, viewBox 24). */
  readonly ICONES = {
    emitido: 'M9 12h6m-6 4h6M7 3h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 012-2z',
    recebido: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    pendente: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    inadimplencia: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  };

  readonly filtroFatura = signal<StatusFatura>('todos');
  readonly filtros: { valor: StatusFatura; label: string }[] = [
    { valor: 'todos', label: 'Todas' },
    { valor: 'paga', label: 'Pagas' },
    { valor: 'pendente', label: 'Pendentes' },
    { valor: 'vencida', label: 'Vencidas' },
  ];

  readonly faturasFiltradas = computed(() => {
    const filtro = this.filtroFatura();
    if (filtro === 'todos') return this.store.faturas();
    return this.store.faturas().filter((f) => f.status === filtro);
  });

  /** Quantas faturas há em cada status — contador dentro do filtro segmentado. */
  readonly contagemStatus = computed(() => {
    const lista = this.store.faturas();
    const mapa: Record<string, number> = {};
    for (const f of this.filtros) mapa[f.valor] = 0;
    mapa['todos'] = lista.length;
    for (const f of lista) mapa[f.status] = (mapa[f.status] ?? 0) + 1;
    return mapa;
  });

  // ── Modais ──
  readonly selectedKpiCard = signal<KpiCard | null>(null);
  readonly faturaDetalhada = signal<Fatura | null>(null);
  readonly whatsCobrancaFatura = signal<Fatura | null>(null);
  readonly whatsMensagemRascunho = signal('');
  readonly whatsTelefoneDestinatario = signal('');
  readonly baixaManualFatura = signal<Fatura | null>(null);
  readonly baixaMetodo = signal<'Pix' | 'Boleto' | 'Dinheiro' | 'Transferência' | 'Outro'>('Pix');
  readonly baixaData = signal('');
  readonly baixaHora = signal('');
  readonly baixaValor = signal(0);
  readonly baixaObservacoes = signal('');

  readonly faturasDoCardSelecionado = computed<Fatura[]>(() => {
    const card = this.selectedKpiCard();
    if (!card) return [];
    const lista = this.store.faturas();
    if (card === 'emitido') return lista;
    if (card === 'recebido') return lista.filter((f) => f.status === 'paga');
    if (card === 'pendente') return lista.filter((f) => f.status === 'pendente');
    return lista.filter((f) => f.status === 'vencida');
  });

  readonly tituloCardSelecionado = computed(() => {
    switch (this.selectedKpiCard()) {
      case 'emitido': return 'Faturamento emitido no mês';
      case 'recebido': return 'Receitas recebidas';
      case 'pendente': return 'Cobranças pendentes';
      case 'inadimplencia': return 'Inadimplência acumulada';
      default: return '';
    }
  });

  readonly valorCardSelecionado = computed(() => {
    const cards = this.store.faturamentoCards();
    switch (this.selectedKpiCard()) {
      case 'emitido': return cards.emitido;
      case 'recebido': return cards.recebido;
      case 'pendente': return cards.pendente;
      case 'inadimplencia': return cards.inadimplencia;
      default: return 0;
    }
  });

  statusLabel(status: Fatura['status']): string {
    return status === 'paga' ? 'Paga' : status === 'vencida' ? 'Vencida' : 'Pendente';
  }

  statusClasse(status: Fatura['status']): string {
    return status === 'paga' ? 'badge badge-success' : status === 'vencida' ? 'badge badge-danger' : 'badge badge-warning';
  }

  abrirDetalheCard(tipo: KpiCard): void {
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

  // ── Cobrança por WhatsApp ──

  abrirCobrarWhats(f: Fatura): void {
    this.whatsCobrancaFatura.set(f);
    const c = this.store.findCliente(f.clienteId);
    this.whatsTelefoneDestinatario.set(c?.contatoPrincipal?.telefone ?? '');

    const cfg = this.store.configAutomacoes();
    const baseMsg =
      f.status === 'vencida' ? cfg.templatePosVencimento
      : f.status === 'pendente' ? cfg.templateVencimento
      : 'Olá, *{{sindico}}*!\nSegue a fatura *{{faturaId}}* do *{{condominio}}* no valor de *{{valor}}*.\n\nLink para segunda via: {{link_pagamento}}';

    const data: Record<string, string> = {
      sindico: c?.contatoPrincipal?.nome ?? 'Síndico',
      condominio: f.condominio,
      plano: c?.plano ?? 'Profissional',
      valor: moeda(f.valor),
      vencimento: new Date(f.vencimento).toLocaleDateString('pt-BR'),
      dias: String(c?.diasParaVencer != null ? Math.abs(c.diasParaVencer) : 0),
      copia_cola: '00020126360014br.gov.bcb.pix0114+5511999998888',
      link_pagamento: `clickprestare.com.br/faturas/${f.id}`,
      faturaId: f.id,
    };

    this.whatsMensagemRascunho.set(
      baseMsg.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (data[k] !== undefined ? data[k] : m)),
    );
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
          payload: JSON.stringify({ faturaId: f.id, destinatario: f.condominio }),
        });
        this.store.carregarDisparos();
        this.toast.trigger(`Cobrança enviada por WhatsApp para ${f.condominio}.`, 'success');
        this.whatsCobrancaFatura.set(null);
      },
      error: (err) => {
        this.store.salvando.set(false);
        this.store.carregarDisparos();
        this.toast.trigger(err?.error?.message ?? 'Falha ao enviar o WhatsApp de cobrança.', 'error');
      },
    });
  }

  // ── Baixa manual ──

  abrirBaixaManual(f: Fatura): void {
    this.baixaManualFatura.set(f);
    this.baixaMetodo.set(f.metodoPagamento === 'Boleto' ? 'Boleto' : 'Pix');
    const hoje = new Date();
    this.baixaData.set(hoje.toISOString().split('T')[0]);
    this.baixaHora.set(hoje.toTimeString().split(' ')[0].substring(0, 5));
    this.baixaValor.set(f.valor);
    this.baixaObservacoes.set('');
  }

  executarBaixaManual(): void {
    const f = this.baixaManualFatura();
    if (!f) return;

    // Validações de UX antes de chamar o backend (que valida de novo).
    const motivo = this.baixaObservacoes().trim();
    if (motivo.length < 5) {
      this.toast.trigger('Informe o motivo/justificativa da baixa manual (mínimo 5 caracteres).', 'error');
      return;
    }
    const valorPago = this.baixaValor();
    if (!(valorPago > 0)) {
      this.toast.trigger('Informe um valor pago maior que zero.', 'error');
      return;
    }
    const dataPagamento = `${this.baixaData()}T${this.baixaHora() || '12:00'}:00.000Z`;
    if (new Date(dataPagamento).getTime() > Date.now() + 24 * 3600 * 1000) {
      this.toast.trigger('A data de pagamento não pode ser no futuro.', 'error');
      return;
    }

    this.store.salvando.set(true);
    this.api.baixarFatura(f.dbId, { metodo: this.baixaMetodo(), motivo, dataPagamento, valorPago }).subscribe({
      next: (res) => {
        this.store.salvando.set(false);
        this.store.carregar();
        this.store.carregarFaturas();

        this.store.manualPaymentsMetadata.update((map) => ({
          ...map,
          [f.id]: { metodo: this.baixaMetodo(), dataPagamento, valorPago, obs: motivo },
        }));

        this.store.pushLog({
          data: new Date().toISOString(),
          origem: 'System',
          evento: 'manual_payment_override',
          status: 'sucesso',
          payload: JSON.stringify({ faturaId: f.id, valorPago, metodo: this.baixaMetodo(), dataPagamento, motivo }),
        });

        // Flash de sucesso na linha liquidada
        this.store.ultimaFaturaPaga.set(f.id);
        setTimeout(() => {
          if (this.store.ultimaFaturaPaga() === f.id) this.store.ultimaFaturaPaga.set(null);
        }, 1400);

        const novoVenc = res?.novoVencimento ? new Date(res.novoVencimento).toLocaleDateString('pt-BR') : '';
        this.toast.trigger(`Fatura ${f.id} liquidada.${novoVenc ? ` Novo vencimento: ${novoVenc}.` : ''}`, 'success');
        this.baixaManualFatura.set(null);
        if (this.faturaDetalhada()?.id === f.id) this.faturaDetalhada.set(null);
      },
      error: (err) => {
        console.error('Erro ao efetuar baixa manual:', err);
        this.store.salvando.set(false);
        this.toast.trigger(err?.error?.message ?? `Erro ao liquidar a fatura ${f.id}.`, 'error');
      },
    });
  }
}
