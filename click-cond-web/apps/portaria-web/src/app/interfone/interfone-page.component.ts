import { Component, inject } from '@angular/core';
import { InterfoneStore } from './interfone.store';
import { LigarUnidadeComponent } from './ligar-unidade.component';
import { ChamadasHojeComponent } from './chamadas-hoje.component';

/**
 * Área do interfone no console (menu Principal → Interfone): estado do console, ligar para a unidade e as chamadas.
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
          <p class="text-sm">Ligue para as unidades e acompanhe as chamadas do condomínio</p>
        </div>
        @if (store.ativo()) {
          @if (store.semChamadas(); as motivo) {
            <p role="status" class="ps-tag !h-auto !py-1.5 max-w-xl !normal-case !tracking-normal !text-xs !font-normal" data-teste="estado-console">
              <span class="ps-dot ps-dot-danger"></span>{{ motivo }}
            </p>
          } @else if (store.somBloqueado()) {
            <button type="button" class="ps-tag !h-8 hover:border-[var(--ink)]" data-teste="estado-console" (click)="store.ativarSom()">
              <span class="ps-dot ps-dot-warn ps-dot-pulse"></span>Som bloqueado · clique para ativar
            </button>
          } @else {
            <p role="status" class="ps-tag !h-8" data-teste="estado-console">
              <span class="ps-dot ps-dot-ok"></span>Pronto para receber chamadas
            </p>
          }
        }
      </div>

      @if (store.ativo()) {
        <section class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-5" aria-label="Interfone">
          <app-ligar-unidade />
          <app-chamadas-hoje />
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
