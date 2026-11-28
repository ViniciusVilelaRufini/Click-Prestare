import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { ChamadaHoje } from './interfone.api';
import { rotuloResultado } from './interfone-lista';

/** Foto do visitante em tamanho grande, com unidade, hora e resultado. Fecha com Esc, clique fora ou o X. */
@Component({
  selector: 'app-foto-chamada',
  standalone: true,
  imports: [DatePipe],
  host: { '(document:keydown.escape)': 'fechar.emit()' },
  template: `
    <div class="ps-scrim on" (click)="fechar.emit()" data-teste="foto-scrim"></div>
    <div class="ps-modal on !w-[min(640px,calc(100%-32px))] !p-0 !gap-0 overflow-hidden" role="dialog" aria-modal="true"
      [attr.aria-label]="'Foto do visitante: ' + chamada().unidade">
      <div class="ps-drawer-head shrink-0">
        <div class="min-w-0">
          <h3 class="ps-h2 truncate">{{ chamada().unidade }}</h3>
          <p class="ps-cap">{{ chamada().inicio | date: 'dd/MM HH:mm' }} · {{ resultado() }}</p>
        </div>
        <button type="button" class="ps-ibtn" aria-label="Fechar foto" (click)="fechar.emit()">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <img [src]="chamada().foto_url" alt="Foto do visitante" class="block w-full max-h-[70vh] object-contain bg-black" />
    </div>
  `,
})
export class FotoChamadaComponent {
  readonly chamada = input.required<ChamadaHoje>();
  readonly fechar = output<void>();

  resultado(): string {
    return rotuloResultado(this.chamada());
  }
}
