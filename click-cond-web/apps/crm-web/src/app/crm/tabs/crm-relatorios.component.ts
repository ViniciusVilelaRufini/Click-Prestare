import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { moeda, pagamentoClasse, pagamentoLabel } from '../crm-format';

type RelatorioTipo = 'financeiro' | 'clientes' | 'portaria' | 'notificacoes';

/** Aba Relatórios: KPIs por tipo de relatório + prévia tabular + exportação CSV/PDF. */
@Component({
  selector: 'crm-relatorios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './crm-relatorios.component.html',
})
export class CrmRelatoriosComponent {
  readonly store = inject(CrmStore);
  private toast = inject(ToastService);

  readonly Math = Math;
  readonly moeda = moeda;
  readonly pagamentoLabel = pagamentoLabel;
  readonly pagamentoClasse = pagamentoClasse;

  readonly relatorioTipo = signal<RelatorioTipo>('financeiro');
  readonly relatorioPeriodo = signal<'30d' | '90d' | 'ano' | 'tudo'>('tudo');
  readonly relatorioGerado = signal(true);
  readonly gerandoRelatorio = signal(false);

  /** Totais de portaria calculados dos clientes reais (antes eram números fixos). */
  readonly totaisPortaria = computed(() => {
    const cs = this.store.clientes();
    const terminais = cs.reduce((s, c) => s + c.dispositivosFaciais, 0);
    const offline = cs.reduce((s, c) => s + c.dispositivosOffline, 0);
    const moradores = cs.reduce((s, c) => s + c.totalMoradores, 0);
    const comFace = cs.reduce((s, c) => s + c.moradoresComFace, 0);
    return {
      terminais,
      offline,
      conectados: terminais - offline,
      moradores,
      adocaoFacial: moradores > 0 ? Math.round((comFace / moradores) * 1000) / 10 : 0,
    };
  });

  /** Totais de disparos calculados do histórico real. */
  readonly totaisDisparos = computed(() => {
    const ds = this.store.historicoDisparos();
    const entregues = ds.filter((d) => d.status === 'entregue').length;
    const falhas = ds.length - entregues;
    return {
      total: ds.length,
      entregues,
      falhas,
      taxa: ds.length > 0 ? Math.round((entregues / ds.length) * 1000) / 10 : 0,
    };
  });

  /** Taxa de adimplência a partir das faturas reais. */
  readonly adimplencia = computed(() => {
    const { emitido, recebido } = this.store.faturamentoCards();
    return emitido > 0 ? Math.round((recebido / emitido) * 1000) / 10 : 0;
  });

  gerarRelatorio(): void {
    this.gerandoRelatorio.set(true);
    setTimeout(() => {
      this.relatorioGerado.set(true);
      this.gerandoRelatorio.set(false);
      this.toast.trigger('Visualização do relatório atualizada.', 'success');
    }, 600);
  }

  exportarCSV(tipo: string): void {
    let csvContent = String.fromCharCode(0xfeff); // BOM para suporte UTF-8 no Excel
    const filename = `relatorio_${tipo}_${new Date().toISOString().split('T')[0]}.csv`;

    if (tipo === 'financeiro') {
      csvContent += 'Condomínio;Plano;Mensalidade (MRR);Status de Cobrança;Dias para Vencer;Saúde Financeira\n';
      for (const c of this.store.clientes()) {
        csvContent += `"${c.nome}";"${c.plano || 'Sem plano'}";"${c.mrr}";"${c.statusPagamento}";"${c.diasParaVencer ?? '—'}";"${pagamentoLabel(c.statusPagamento)}"\n`;
      }
    } else if (tipo === 'clientes') {
      csvContent += 'Condomínio;Estágio;Cidade;UF;Plano;Health Score;Dias para Vencer\n';
      for (const c of this.store.clientes()) {
        csvContent += `"${c.nome}";"${c.estagio}";"${c.cidade || '—'}";"${c.uf || '—'}";"${c.plano || 'Sem plano'}";${c.healthScore};"${c.diasParaVencer ?? '—'}"\n`;
      }
    } else if (tipo === 'portaria') {
      csvContent += 'Condomínio;Apartamentos;Moradores;Cadastros Faciais;Adoção RFID (Tags);Terminais Faciais;Dispositivos Offline\n';
      for (const c of this.store.clientes()) {
        csvContent += `"${c.nome}";${c.totalApartamentos};${c.totalMoradores};${c.moradoresComFace};${c.moradoresComTag};${c.dispositivosFaciais};${c.dispositivosOffline}\n`;
      }
    } else if (tipo === 'notificacoes') {
      csvContent += 'Data;Condomínio;Tipo de Disparo;Status;Telefone/WhatsApp;Erro\n';
      for (const d of this.store.historicoDisparos()) {
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

      this.toast.trigger(`Relatório CSV baixado com sucesso: ${filename}`, 'success');
    }
  }

  exportarPDF(_tipo: string): void {
    this.toast.trigger('Gerando visualização PDF do relatório...', 'info');
    setTimeout(() => window.print(), 500);
  }
}
