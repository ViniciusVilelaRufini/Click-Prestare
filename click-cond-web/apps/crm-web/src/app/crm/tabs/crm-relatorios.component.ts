import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmStore } from '../crm.store';
import { ToastService } from '../../shared/toast.service';
import { moeda, pagamentoClasse, pagamentoLabel } from '../crm-format';

type RelatorioTipo = 'financeiro' | 'clientes' | 'portaria' | 'notificacoes';
type Tom = 'green' | 'beige' | 'purple' | 'tosca' | 'red';

/** Um indicador do painel de relatórios, já formatado para exibição. */
interface KpiRelatorio {
  label: string;
  valor: string;
  detalhe: string;
  tom: Tom;
  icone: string;
}

/** Paths dos ícones usados nos tiles (heroicons outline, viewBox 24). */
const ICONES = {
  moeda: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  grafico: 'M3 3v18h18M7 15l3.5-3.5 3 3L18 9',
  predios: 'M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2M5 21H3m6-14h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  alerta: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  pessoas: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-6.9M15 7a4 4 0 11-8 0 4 4 0 018 0z',
  camera: 'M15 13a3 3 0 11-6 0 3 3 0 016 0zM3 9a2 2 0 012-2h1.5l1-2h6l1 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9z',
  novo: 'M12 4v16m8-8H4',
  raio: 'M13 10V3L4 14h7v7l9-11h-7z',
  chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  ticket: 'M7 7h.01M7 3h5a1.99 1.99 0 0 1 1.414.586l7 7a2 2 0 0 1 0 2.828l-7 7a2 2 0 0 1-2.828 0l-7-7A1.99 1.99 0 0 1 3 12V7a4 4 0 0 1 4-4z',
};

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

  /** Os quatro relatórios, apresentados como cards selecionáveis. */
  readonly tipos: { valor: RelatorioTipo; label: string; descricao: string; icone: string; tom: Tom }[] = [
    {
      valor: 'financeiro',
      label: 'Financeiro',
      descricao: 'Faturamento e conciliação de cobranças',
      icone: ICONES.moeda,
      tom: 'green',
    },
    {
      valor: 'clientes',
      label: 'Carteira',
      descricao: 'Crescimento de condomínios e planos',
      icone: ICONES.predios,
      tom: 'beige',
    },
    {
      valor: 'portaria',
      label: 'Portaria',
      descricao: 'Adoção de tecnologia e hardware',
      icone: ICONES.camera,
      tom: 'purple',
    },
    {
      valor: 'notificacoes',
      label: 'Notificações',
      descricao: 'Logs e régua de disparos WhatsApp',
      icone: ICONES.chat,
      tom: 'tosca',
    },
  ];

  readonly periodos: { valor: '30d' | '90d' | 'ano' | 'tudo'; label: string }[] = [
    { valor: '30d', label: '30 dias' },
    { valor: '90d', label: '90 dias' },
    { valor: 'ano', label: 'Este ano' },
    { valor: 'tudo', label: 'Tudo' },
  ];

  /** Rótulo do relatório ativo — usado no cabeçalho da prévia. */
  readonly tipoAtivo = computed(
    () => this.tipos.find((t) => t.valor === this.relatorioTipo()) ?? this.tipos[0],
  );

  /** Quantas linhas o export vai conter, para o contador da prévia. */
  readonly totalLinhas = computed(() =>
    this.relatorioTipo() === 'notificacoes'
      ? this.store.historicoDisparos().length
      : this.store.clientes().length,
  );

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

  /**
   * Os quatro indicadores do relatório ativo, já formatados. Centralizar aqui
   * evita repetir dezesseis cards quase idênticos no template.
   */
  readonly kpis = computed<KpiRelatorio[]>(() => {
    const ov = this.store.overview();

    switch (this.relatorioTipo()) {
      case 'financeiro': {
        const mrr = ov?.mrrTotal ?? 0;
        return [
          { label: 'Receita recorrente (MRR)', valor: moeda(mrr), detalhe: 'Assinaturas ativas do CRM', tom: 'green', icone: ICONES.moeda },
          { label: 'Receita projetada (ARR)', valor: moeda(mrr * 12), detalhe: 'MRR anualizado', tom: 'beige', icone: ICONES.grafico },
          { label: 'Taxa de adimplência', valor: `${this.adimplencia()}%`, detalhe: 'Recebido sobre emitido', tom: 'tosca', icone: ICONES.check },
          {
            label: 'Inadimplência real',
            valor: moeda(ov?.emAtraso?.valor ?? 0),
            detalhe: `${ov?.emAtraso?.quantidade ?? 0} condomínio(s) em atraso`,
            tom: 'red',
            icone: ICONES.alerta,
          },
        ];
      }
      case 'clientes':
        return [
          { label: 'Condomínios totais', valor: String(this.store.clientes().length), detalhe: 'Total registrado no CRM', tom: 'green', icone: ICONES.predios },
          { label: 'Clientes ativos', valor: String(ov?.clientesAtivos ?? 0), detalhe: 'Operação regular ativa', tom: 'tosca', icone: ICONES.check },
          { label: 'Novas contratações (30d)', valor: String(ov?.novos30d ?? 0), detalhe: 'Novos condomínios adicionados', tom: 'purple', icone: ICONES.novo },
          { label: 'Ticket médio mensal', valor: moeda(ov?.ticketMedio ?? 0), detalhe: 'Faturamento médio por cliente', tom: 'beige', icone: ICONES.ticket },
        ];
      case 'portaria': {
        const p = this.totaisPortaria();
        return [
          { label: 'Terminais faciais', valor: String(p.terminais), detalhe: 'Dispositivos de acesso', tom: 'green', icone: ICONES.camera },
          {
            label: 'Terminais conectados',
            valor: String(p.conectados),
            detalhe: `${p.offline} equipamento(s) offline`,
            tom: p.offline > 0 ? 'red' : 'tosca',
            icone: ICONES.check,
          },
          { label: 'Total de moradores', valor: String(p.moradores), detalhe: 'Residentes cadastrados', tom: 'purple', icone: ICONES.pessoas },
          { label: 'Adoção facial média', valor: `${p.adocaoFacial}%`, detalhe: 'Com foto facial válida', tom: 'beige', icone: ICONES.grafico },
        ];
      }
      default: {
        const d = this.totaisDisparos();
        return [
          { label: 'Notificações disparadas', valor: String(d.total), detalhe: 'Total de mensagens no período', tom: 'green', icone: ICONES.raio },
          { label: 'Mensagens entregues', valor: String(d.entregues), detalhe: 'Entregues com sucesso', tom: 'tosca', icone: ICONES.check },
          {
            label: 'Falhas de envio',
            valor: String(d.falhas),
            detalhe: 'Rejeitadas pelo gateway',
            tom: d.falhas > 0 ? 'red' : 'beige',
            icone: ICONES.alerta,
          },
          { label: 'Taxa de entrega (Z-API)', valor: `${d.taxa}%`, detalhe: 'Sucesso sobre total disparado', tom: 'purple', icone: ICONES.grafico },
        ];
      }
    }
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
