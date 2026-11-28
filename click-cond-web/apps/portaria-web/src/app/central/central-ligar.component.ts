import { Component, inject, signal } from '@angular/core';
import { UnidadeCentral } from './central-api';
import { CentralBuscaUnidadeComponent } from './central-busca-unidade.component';
import { CentralStore } from './central.store';

/** "Ligar": o operador escolhe o condomínio, busca a unidade e liga (toca no app dos moradores e nos monitores). */
@Component({
  selector: 'app-central-ligar',
  standalone: true,
  imports: [CentralBuscaUnidadeComponent],
  host: { class: 'block' },
  template: `
    <section class="ps-panel max-w-[560px]" aria-labelledby="titulo-ligar-central">
      <div class="ps-panel-head">
        <h2 id="titulo-ligar-central" class="ps-h2">Ligar para uma unidade</h2>
        <span class="ps-cap">Interfone pelo app</span>
      </div>
      <div class="px-4 py-4 space-y-3">
        <label class="block">
          <span class="ps-label">Condomínio</span>
          <span class="ps-field mt-1.5">
            <select name="condominio-ligar" aria-label="Condomínio" (change)="escolherCondominio($any($event.target).value)">
              <option value="" [selected]="!idCondominio()">Escolha o condomínio</option>
              @for (c of store.condominios(); track c.id) {
                <option [value]="c.id" [selected]="idCondominio() === c.id">{{ c.nome }}</option>
              }
            </select>
          </span>
        </label>
        @if (!store.condominios().length) {
          <p class="ps-cap">Nenhum condomínio atendido pela central.</p>
        }
        @if (idCondominio()) {
          <app-central-busca-unidade
            [idCondominio]="idCondominio()"
            acao="Ligar"
            nome="unidade-ligar"
            rotuloBusca="Buscar unidade para ligar"
            [desabilitado]="store.ocupado()"
            (escolhida)="ligar($event)" />
        }
        @if (store.ocupado()) {
          <p class="ps-cap">Termine a chamada atual para ligar.</p>
        }
      </div>
    </section>
  `,
})
export class CentralLigarComponent {
  readonly store = inject(CentralStore);
  readonly idCondominio = signal<number | null>(null);

  escolherCondominio(valor: string): void {
    const id = Number(valor);
    this.idCondominio.set(Number.isInteger(id) && id > 0 ? id : null);
  }

  ligar(u: UnidadeCentral): void {
    const id = this.idCondominio();
    if (!id || this.store.ocupado()) return;
    void this.store.ligar(id, u.id, u.rotulo);
  }
}
