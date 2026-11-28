import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CentralApi, ItemHistoricoCentral } from './central-api';

/** Hoje em Brasília (AAAA-MM-DD). */
export function hojeBrasilia(agora = Date.now()): string {
  return new Date(agora - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Resultado da chamada em texto curto. */
export function resultadoDoHistorico(i: Pick<ItemHistoricoCentral, 'resultado' | 'estado' | 'tipo'>): string {
  switch (i.resultado) {
    case 'atendida_central':
      return 'Atendida pela central';
    case 'atendida_morador':
      return 'Morador atendeu';
    case 'atendida_portaria':
      return 'Portaria atendeu';
    case 'nao_atendida':
      return 'Ninguém atendeu';
    case 'recusada':
      return 'Recusada';
    case 'cancelada':
      return 'Cancelada';
    case 'falha':
      return 'Falhou';
    default:
      return i.estado === 'encerrada' ? 'Encerrada' : 'Em andamento';
  }
}

/** Chamadas da central num dia (até 30 dias atrás), de todos os condomínios. Só leitura. */
@Component({
  selector: 'app-central-historico',
  standalone: true,
  imports: [DatePipe],
  host: { class: 'block' },
  template: `
    <section class="ps-panel" aria-labelledby="titulo-historico-central">
      <div class="ps-panel-head">
        <h2 id="titulo-historico-central" class="ps-h2">Histórico</h2>
        <label class="ps-field h-[34px] w-[170px]">
          <input type="date" name="data-historico" aria-label="Dia do histórico" [max]="hoje" [value]="data()"
            (change)="trocarDia($any($event.target).value)" />
        </label>
      </div>
      @if (erro()) {
        <p role="alert" class="ps-cap px-4 py-4">{{ erro() }}</p>
      } @else if (carregando()) {
        <p class="ps-cap px-4 py-6">Carregando…</p>
      } @else if (!itens().length) {
        <p class="ps-cap px-4 py-6 text-center">Nenhuma chamada da central neste dia.</p>
      } @else {
        <div class="ps-tablewrap">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left">
                <th class="ps-label px-4 py-2 font-semibold">Hora</th>
                <th class="ps-label px-4 py-2 font-semibold">Condomínio</th>
                <th class="ps-label px-4 py-2 font-semibold">Unidade</th>
                <th class="ps-label px-4 py-2 font-semibold">Resultado</th>
                <th class="ps-label px-4 py-2 font-semibold">Atendeu</th>
                <th class="ps-label px-4 py-2 font-semibold">Portão</th>
              </tr>
            </thead>
            <tbody>
              @for (i of itens(); track i.id) {
                <tr class="border-t border-[var(--line-100)]">
                  <td class="px-4 py-2 tabular-nums whitespace-nowrap">{{ i.inicio | date: 'HH:mm' }}</td>
                  <td class="px-4 py-2">{{ i.condominio }}{{ i.portao ? ' · ' + i.portao : '' }}</td>
                  <td class="px-4 py-2">{{ i.unidade || 'Portaria' }}</td>
                  <td class="px-4 py-2">{{ resultado(i) }}</td>
                  <td class="px-4 py-2">{{ i.atendida_por_nome || '—' }}</td>
                  <td class="px-4 py-2">{{ i.porta_aberta ? 'Aberto' + (i.porta_aberta_por_nome ? ' por ' + i.porta_aberta_por_nome : '') : '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
})
export class CentralHistoricoComponent implements OnInit {
  private readonly api = inject(CentralApi);
  readonly hoje = hojeBrasilia();
  readonly data = signal(this.hoje);
  readonly itens = signal<ItemHistoricoCentral[]>([]);
  readonly carregando = signal(false);
  readonly erro = signal<string | null>(null);

  ngOnInit(): void {
    this.carregar();
  }

  trocarDia(valor: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return;
    this.data.set(valor);
    this.carregar();
  }

  resultado(i: ItemHistoricoCentral): string {
    return resultadoDoHistorico(i);
  }

  carregar(): void {
    const dia = this.data();
    this.carregando.set(true);
    this.erro.set(null);
    this.api.historico(dia).subscribe({
      next: (l) => {
        if (this.data() !== dia) return;
        this.itens.set(Array.isArray(l) ? l : []);
        this.carregando.set(false);
      },
      error: (e) => {
        if (this.data() !== dia) return;
        this.carregando.set(false);
        this.itens.set([]);
        this.erro.set(e?.status === 400 ? 'Escolha um dia dos últimos 30 dias.' : 'Não foi possível carregar o histórico.');
      },
    });
  }
}
