import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

/**
 * Aba Automações: régua de mensagens WhatsApp (3 gatilhos) com preview ao vivo
 * simulando um celular + histórico real de disparos (Z-API).
 */
@Component({
  selector: 'crm-automacoes',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent],
  templateUrl: './crm-automacoes.component.html',
})
export class CrmAutomacoesComponent {
  readonly store = inject(CrmStore);
  private readonly toast = inject(ToastService);

  readonly previewTemplate = signal<'pre' | 'venc' | 'pos'>('pre');

  readonly previewTabs: { valor: 'pre' | 'venc' | 'pos'; label: string }[] = [
    { valor: 'pre', label: 'Aviso prévio' },
    { valor: 'venc', label: 'No vencimento' },
    { valor: 'pos', label: 'Atraso' },
  ];

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

  /**
   * Método (não computed): os textareas mutam o objeto in-place, então
   * precisa reavaliar a cada ciclo de detecção de mudanças (zone-based).
   */
  previewMensagemHtml(): string {
    const cfg = this.store.configAutomacoes();
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
      .replace(/`([^`]+)`/g, '<code class="rounded bg-black/20 px-1">$1</code>')
      .replace(/_([^_]+)_/g, '<i>$1</i>');
  }

  readonly tagsDisponiveis = [
    '{{sindico}}', '{{condominio}}', '{{plano}}', '{{valor}}',
    '{{vencimento}}', '{{dias}}', '{{copia_cola}}', '{{link_pagamento}}',
  ];

  /** Copia a tag para a área de transferência — atalho ao montar o template. */
  copiarTag(tag: string): void {
    navigator.clipboard
      ?.writeText(tag)
      .then(() => this.toast.trigger(`Tag ${tag} copiada.`, 'success'))
      .catch(() => this.toast.trigger('Não foi possível copiar a tag.', 'error'));
  }
}
