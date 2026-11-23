import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CrmStore } from '../crm.store';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { SkeletonComponent } from '../../shared/ui/skeleton.component';
import { KpiCardComponent } from '../../shared/ui/kpi-card.component';
import { ModoAnexo, TAXA_IMPLANTACAO, calcularSimples, precoMensalPorUnidades } from '../impostos/simples-nacional';

/**
 * Aba Impostos: estimativa do DAS (Simples Nacional) do mês, por tributo e por
 * cliente, simulador de nova venda e configuração (anexo, folha, início).
 */
@Component({
  selector: 'crm-impostos',
  standalone: true,
  imports: [CommonModule, FormsModule, EmptyStateComponent, SkeletonComponent, KpiCardComponent],
  templateUrl: './crm-impostos.component.html',
})
export class CrmImpostosComponent {
  readonly store = inject(CrmStore);
  readonly TAXA_IMPLANTACAO = TAXA_IMPLANTACAO;

  readonly ICONES = {
    receita: 'M3 3v18h18M7 14l3-3 3 3 5-5',
    faixa: 'M4 6h16M4 12h10M4 18h6',
    aliquota: 'M9 14.25l6-6M9.75 9h.008M14.25 13.5h.008M19.5 4.757V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757',
    das: 'M9 12h6m-6 4h6M7 3h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 012-2z',
  };

  readonly imp = this.store.impostoMes;

  /** Sem faturas e sem MRR para estimar: mostra o estado vazio. */
  readonly semDados = computed(() => this.imp().semDados);

  /** Próxima faixa: quanto falta e a alíquota efetiva logo acima do limite. */
  readonly proximaFaixa = computed(() => {
    const s = this.imp().simples;
    if (s.faixa >= 6) return null;
    return {
      falta: s.limiteFaixa - s.rbt12,
      aliquota: calcularSimples(s.limiteFaixa + 1, s.anexo).aliquotaEfetiva,
    };
  });

  readonly totaisClientes = computed(() => {
    const l = this.imp().porCliente;
    return {
      mensalidade: l.reduce((a, c) => a + c.mensalidade, 0),
      imposto: l.reduce((a, c) => a + c.imposto, 0),
      liquido: l.reduce((a, c) => a + c.liquido, 0),
    };
  });

  // Simulador
  readonly unidades = signal<number | null>(80);
  readonly sim = computed(() => {
    const aliq = this.imp().simples.aliquotaEfetiva;
    const mensalidade = precoMensalPorUnidades(Number(this.unidades()) || 0);
    const imposto = mensalidade * aliq;
    const impImpl = TAXA_IMPLANTACAO * aliq;
    return { mensalidade, imposto, liquido: mensalidade - imposto, impImpl, liqImpl: TAXA_IMPLANTACAO - impImpl };
  });

  // Configuração (campos locais, re-sincronizados quando a config do store muda)
  readonly cfgModo = signal<ModoAnexo>('fator_r');
  readonly cfgFolha = signal<number | null>(0);
  readonly cfgInicio = signal('');

  constructor() {
    effect(() => {
      const c = this.store.configImposto();
      this.cfgModo.set(c.modoAnexo);
      this.cfgFolha.set(c.folhaMensal);
      this.cfgInicio.set(c.inicioAtividade ?? '');
    });
  }

  salvar(): void {
    const inicio = this.cfgInicio().trim();
    this.store.salvarConfigImposto({
      modoAnexo: this.cfgModo(),
      folhaMensal: Math.max(0, Number(this.cfgFolha()) || 0),
      inicioAtividade: /^(0[1-9]|1[0-2])\/\d{4}$/.test(inicio) ? inicio : null,
    });
  }

  /** Fração -> percentual pt-BR com 2 casas (0,06 -> "6,00%"). */
  pct(f: number): string {
    return (f * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }

  /** Valor em reais com centavos. */
  cents(v: number): string {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
