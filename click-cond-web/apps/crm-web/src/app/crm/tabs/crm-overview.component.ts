import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CrmStore } from '../crm.store';
import { AuthService } from '../../auth/auth.service';
import { KpiCardComponent } from '../../shared/ui/kpi-card.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { iniciais, moeda, severidadeDot } from '../crm-format';

export type AbaCrm = 'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes' | 'relatorios' | 'chamados';

/** Paleta cromática das séries — mesma ordem de --chart-1..5 em styles.css. */
const CORES_SERIE = ['#6e9179', '#e5d5b0', '#c5dfe1', '#b7bcd9', '#4a6b52'];

/** Raio do doughnut (viewBox 140) e circunferência derivada. */
const RAIO_DONUT = 54;
const CIRC_DONUT = 2 * Math.PI * RAIO_DONUT;

/**
 * Aba Visão geral: KPIs do negócio, colunas de receita recorrente por mês,
 * composição do MRR por plano (doughnut), maiores contas e radar de risco.
 */
@Component({
  selector: 'crm-overview',
  standalone: true,
  imports: [CommonModule, RouterLink, KpiCardComponent, EmptyStateComponent, SkeletonComponent],
  templateUrl: './crm-overview.component.html',
})
export class CrmOverviewComponent {
  readonly store = inject(CrmStore);
  readonly auth = inject(AuthService);

  readonly Math = Math;
  readonly moeda = moeda;
  readonly iniciais = iniciais;
  readonly severidadeDot = severidadeDot;
  readonly CIRC_DONUT = CIRC_DONUT;
  readonly RAIO_DONUT = RAIO_DONUT;

  /** Paths dos ícones dos KPIs (heroicons outline, viewBox 24). */
  readonly ICONES = {
    moeda: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 9v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    grafico: 'M3 3v18h18M7 15l3.5-3.5 3 3L18 9',
    predios: 'M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16m14 0h2M5 21H3m6-14h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5',
    ticket: 'M7 7h.01M7 3h5a1.99 1.99 0 0 1 1.414.586l7 7a2 2 0 0 1 0 2.828l-7 7a2 2 0 0 1-2.828 0l-7-7A1.99 1.99 0 0 1 3 12V7a4 4 0 0 1 4-4z',
  };

  /** Coluna do gráfico sob o cursor (null = destaca o mês corrente). */
  readonly mesFocado = signal<number | null>(null);

  /** Série de faturamento emitido por mês, vinda das faturas reais. */
  readonly serieReceita = computed(() => this.store.historicoReceita().map((d) => d.valor));

  /**
   * Variação do faturamento do último mês sobre o anterior.
   * `null` quando ainda não há dois meses de faturas para comparar — nesse
   * caso nenhum delta é exibido, em vez de mostrar 0% como se fosse estável.
   */
  readonly variacaoFaturamento = computed<number | null>(() => {
    const s = this.serieReceita();
    if (s.length < 2) return null;
    const anterior = s[s.length - 2];
    if (!anterior) return null;
    return Math.round(((s[s.length - 1] - anterior) / anterior) * 1000) / 10;
  });

  /** Colunas do gráfico de receita: altura relativa ao pico da série. */
  readonly barras = computed(() => {
    const dados = this.store.historicoReceita();
    const max = Math.max(...dados.map((d) => d.valor), 1);
    return dados.map((d, i) => ({
      mes: d.mes,
      valor: d.valor,
      altura: Math.max(4, Math.round((d.valor / max) * 100)),
      ativo: i === dados.length - 1,
    }));
  });

  /** Coluna em destaque: a sob o cursor ou, sem hover, o mês corrente. */
  readonly barraDestaque = computed(() => {
    const barras = this.barras();
    if (!barras.length) return null;
    const idx = this.mesFocado() ?? barras.length - 1;
    return { ...barras[idx], indice: idx };
  });

  /** Marcas do eixo Y (topo → base), rotuladas em escala curta. */
  readonly escalaY = computed(() => {
    const max = Math.max(...this.barras().map((b) => b.valor), 1);
    return [1, 0.75, 0.5, 0.25, 0].map((f) => this.curta(max * f));
  });

  /** Composição do MRR por plano, já em arcos do doughnut. */
  readonly donut = computed(() => {
    const ov = this.store.overview();
    if (!ov?.porPlano?.length) return { segmentos: [], total: 0 };

    const total = ov.porPlano.reduce((s, p) => s + p.mrr, 0);
    let acumulado = 0;

    const segmentos = ov.porPlano.map((p, i) => {
      const fracao = total > 0 ? p.mrr / total : 0;
      const comprimento = fracao * CIRC_DONUT;
      const seg = {
        plano: p.plano,
        mrr: p.mrr,
        clientes: p.clientes,
        pct: Math.round(fracao * 100),
        cor: CORES_SERIE[i % CORES_SERIE.length],
        dash: `${comprimento} ${CIRC_DONUT - comprimento}`,
        offset: -acumulado,
      };
      acumulado += comprimento;
      return seg;
    });

    return { segmentos, total };
  });

  /**
   * Posição horizontal do tooltip da coluna, presa entre 8% e 92%.
   * Sem isso ele vaza do card nas colunas das pontas, já que é centrado
   * com translate(-50%) sobre a própria posição.
   */
  posicaoTooltip(indice: number): number {
    const centro = ((indice + 0.5) / Math.max(this.barras().length, 1)) * 100;
    return Math.min(Math.max(centro, 8), 92);
  }

  /** Formato compacto para eixos e legendas (R$ 8,2 mil / R$ 1,4 mi). */
  curta(v: number): string {
    if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')} mi`;
    if (v >= 1000) return `R$ ${(v / 1000).toFixed(1).replace('.', ',')} mil`;
    return `R$ ${Math.round(v)}`;
  }
}
