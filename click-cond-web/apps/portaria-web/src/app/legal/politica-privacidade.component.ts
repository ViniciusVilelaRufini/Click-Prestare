import { Component } from '@angular/core';

/**
 * /politica-de-privacidade e /politica-privacidade (sem .html) caem no SPA.
 * O texto oficial é um só: public/politica-de-privacidade.html. Esta rota
 * existe apenas para quem digita o endereço sem extensão ou segue link antigo,
 * e leva para a página estática mantendo a âncora (#biometria, por exemplo).
 * Não duplique o texto da política aqui: duas versões já divergiram antes.
 */
@Component({
  selector: 'app-politica-privacidade',
  standalone: true,
  template: `
    <main class="min-h-screen app-bg text-slate-300 flex items-center justify-center px-6">
      <p class="text-sm">
        Abrindo a
        <a [href]="destino" class="text-white underline font-semibold">Política de Privacidade</a>.
      </p>
    </main>
  `,
})
export class PoliticaPrivacidadeComponent {
  readonly destino = '/politica-de-privacidade.html' + (typeof location !== 'undefined' ? location.hash : '');

  constructor() {
    if (typeof location !== 'undefined') location.replace(this.destino);
  }
}
