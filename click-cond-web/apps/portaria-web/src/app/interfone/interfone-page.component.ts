import { Component, inject } from '@angular/core';
import { InterfoneStore } from './interfone.store';
import { LigarUnidadeComponent } from './ligar-unidade.component';
import { ChamadasHojeComponent } from './chamadas-hoje.component';

/**
 * Área do interfone no console (menu Principal → Interfone): ligar para a unidade e as chamadas de hoje.
 * Atender uma chamada não depende desta tela: o painel de chamada aparece em qualquer página.
 */
@Component({
  selector: 'app-interfone-page',
  standalone: true,
  imports: [LigarUnidadeComponent, ChamadasHojeComponent],
  template: `
    <div class="min-h-screen p-4 min-[900px]:p-8 space-y-5">
      <div class="ps-phead">
        <div class="ps-phead-t">
          <h1 class="ps-h1">Interfone</h1>
          <p class="text-sm">Ligue para as unidades e acompanhe as chamadas do dia</p>
        </div>
      </div>

      @if (store.ativo()) {
        <section class="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-5" aria-label="Interfone">
          <app-ligar-unidade />
          <app-chamadas-hoje [alturaLivre]="true" />
        </section>
      } @else {
        <section class="ps-panel px-5 py-8 text-center" data-teste="interfone-inativo">
          <p class="text-sm text-[var(--ink-muted)]">O interfone não está ativo para este acesso.</p>
          <p class="ps-cap mt-1">Ele aparece para o porteiro quando o módulo está contratado e ligado pelo síndico.</p>
        </section>
      }
    </div>
  `,
})
export class InterfonePageComponent {
  readonly store = inject(InterfoneStore);
}
