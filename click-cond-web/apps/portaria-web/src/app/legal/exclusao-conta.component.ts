import { Component } from '@angular/core';

/**
 * /exclusao-de-conta e /exclusao-conta (sem .html) caem no SPA.
 * O texto oficial é um só: public/exclusao-de-conta.html (é o link declarado
 * nas lojas de aplicativo). Esta rota só leva para a página estática,
 * mantendo a âncora. Não duplique o texto aqui.
 */
@Component({
  selector: 'app-exclusao-conta',
  standalone: true,
  template: `
    <main class="min-h-screen app-bg text-slate-300 flex items-center justify-center px-6">
      <p class="text-sm">
        Abrindo a página de
        <a [href]="destino" class="text-white underline font-semibold">exclusão de conta e dados</a>.
      </p>
    </main>
  `,
})
export class ExclusaoContaComponent {
  readonly destino = '/exclusao-de-conta.html' + (typeof location !== 'undefined' ? location.hash : '');

  constructor() {
    if (typeof location !== 'undefined') location.replace(this.destino);
  }
}
