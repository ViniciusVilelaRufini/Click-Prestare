import { Component, EventEmitter, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrmStore } from '../crm.store';
import { AuthService } from '../../auth/auth.service';
import { KpiCardComponent } from '../../shared/ui/kpi-card.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { iniciais, moeda, severidadeDot } from '../crm-format';

export type AbaCrm = 'overview' | 'clientes' | 'faturamento' | 'automacoes' | 'configuracoes' | 'relatorios' | 'chamados';

/**
 * Aba Overview: KPIs do negócio, curva de MRR, distribuição por plano,
 * entradas recentes e radar de risco (alertas de churn/cobrança).
 */
@Component({
  selector: 'crm-overview',
  standalone: true,
  imports: [CommonModule, KpiCardComponent, EmptyStateComponent, SkeletonComponent],
  templateUrl: './crm-overview.component.html',
})
export class CrmOverviewComponent {
  readonly store = inject(CrmStore);
  readonly auth = inject(AuthService);

  /** Navegação entre abas continua no componente pai (até virar rota). */
  @Output() navegar = new EventEmitter<AbaCrm>();

  readonly Math = Math;
  readonly moeda = moeda;
  readonly iniciais = iniciais;
  readonly severidadeDot = severidadeDot;

  /** Série do gráfico (12 meses) como array simples, para os sparklines. */
  readonly serieReceita = computed(() => this.store.historicoReceita().map((d) => d.valor));

  /** Variação percentual do último mês sobre o anterior — calculada, não fixa. */
  readonly variacaoMrr = computed(() => {
    const s = this.serieReceita();
    if (s.length < 2) return 0;
    const anterior = s[s.length - 2];
    if (!anterior) return 0;
    return Math.round(((s[s.length - 1] - anterior) / anterior) * 1000) / 10;
  });

  /** Caminho SVG da curva de MRR (área + linha + pontos). */
  readonly pathHistorico = computed(() => {
    const dados = this.store.historicoReceita();
    const values = dados.map((d) => d.valor);
    const maxVal = Math.max(...values) * 1.1;
    const minVal = Math.min(...values) * 0.9;
    const range = maxVal - minVal || 1;

    const width = 600;
    const height = 150;

    const points = dados.map((d, index) => ({
      x: (index / (dados.length - 1)) * width,
      y: height - 10 - ((d.valor - minVal) / range) * (height - 20),
    }));

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

    return { linePath, areaPath, points };
  });

  /** Distribuição por plano com cores do design system. */
  readonly planosDistribuicao = computed(() => {
    const ov = this.store.overview();
    if (!ov) return [];

    const total = ov.clientesAtivos || 1;
    const cores = ['bg-accent', 'bg-info', 'bg-success', 'bg-ink-muted'];

    return ov.porPlano.map((p, idx) => ({
      plano: p.plano,
      clientes: p.clientes,
      mrr: p.mrr,
      pct: Math.round((p.clientes / total) * 100),
      cor: cores[idx % cores.length],
    }));
  });
}
