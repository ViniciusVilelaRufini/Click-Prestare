import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ChamadaHoje, ResultadoChamada, TipoChamada } from './interfone.api';
import { InterfoneStore } from './interfone.store';

const TIPO: Record<TipoChamada, string> = {
  facial_unidade: 'Portão → unidade',
  portaria_unidade: 'Portaria → unidade',
  unidade_portaria: 'Unidade → portaria',
};

const RESULTADO: Record<ResultadoChamada, string> = {
  atendida_morador: 'Atendida pelo morador',
  atendida_portaria: 'Atendida pela portaria',
  nao_atendida: 'Não atendida',
  recusada: 'Recusada',
  falha: 'Falha',
  cancelada: 'Desligou antes',
};

export function rotuloResultado(c: Pick<ChamadaHoje, 'resultado'>): string {
  return c.resultado ? (RESULTADO[c.resultado] ?? c.resultado) : 'Em andamento';
}

/** Chamadas do interfone de hoje no condomínio (o porteiro vê tipo, foto e resultado). */
@Component({
  selector: 'app-chamadas-hoje',
  standalone: true,
  host: { class: 'block' },
  imports: [DatePipe],
  template: `
    <section class="ps-panel h-full" aria-labelledby="titulo-chamadas-hoje">
      <div class="ps-panel-head">
        <h2 id="titulo-chamadas-hoje" class="ps-h2">Chamadas de hoje</h2>
        <span class="ps-tag">{{ store.hoje().length }} chamadas</span>
      </div>
      @for (c of store.hoje(); track c.id) {
        <div class="flex items-center gap-3.5 px-5 py-3 border-b border-[var(--line-100)] last:border-b-0">
          @if (c.foto_url) {
            <img [src]="c.foto_url" alt="Foto do visitante" class="w-10 h-10 object-cover border border-[var(--line-200)] shrink-0" loading="lazy" />
          } @else {
            <span class="ps-avatar shrink-0" aria-hidden="true">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106a1.125 1.125 0 00-1.173.417l-.97 1.293a12.035 12.035 0 01-7.143-7.143l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>
            </span>
          }
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">{{ c.unidade }}</p>
            <p class="ps-cap truncate">{{ tipo(c) }} · {{ resultado(c) }}@if (c.atendida_por_nome) { · {{ c.atendida_por_nome }}}</p>
          </div>
          <div class="flex flex-col items-end gap-1 shrink-0">
            <span class="ps-cap tabular-nums">{{ c.inicio | date: 'HH:mm' }}</span>
            @if (c.porta_aberta) {
              <span class="ps-tag"><span class="ps-dot ps-dot-ok"></span>Portão aberto</span>
            }
          </div>
        </div>
      } @empty {
        <p class="px-5 py-6 text-center text-sm text-[var(--ink-muted)]">Nenhuma chamada hoje.</p>
      }
    </section>
  `,
})
export class ChamadasHojeComponent {
  readonly store = inject(InterfoneStore);

  tipo(c: ChamadaHoje): string {
    return TIPO[c.tipo] ?? c.tipo;
  }

  resultado(c: ChamadaHoje): string {
    return rotuloResultado(c);
  }
}
