import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, of, switchMap } from 'rxjs';
import { CentralApi, UnidadeCentral } from './central-api';

/**
 * Busca de unidade num condomínio da central (`GET central/condominios/:id/unidades?busca=`): o operador digita
 * bloco ou número e escolhe. Usada no "Ligar" e no pedido ao morador de uma chamada da portaria (sem unidade).
 */
@Component({
  selector: 'app-central-busca-unidade',
  standalone: true,
  host: { class: 'block' },
  template: `
    <label class="ps-field">
      <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.2-5.2M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"/></svg>
      <input
        type="search"
        [attr.name]="nome()"
        placeholder="Bloco ou apartamento"
        autocomplete="off"
        [attr.aria-label]="rotuloBusca()"
        [disabled]="!idCondominio()"
        [value]="busca()"
        (input)="buscar($any($event.target).value)"
      />
    </label>
    @if (erro()) {
      <p role="alert" class="ps-cap mt-1.5">{{ erro() }}</p>
    }
    @if (resultados().length) {
      <ul class="mt-1.5 max-h-[12rem] overflow-y-auto border border-[var(--line-100)]" data-teste="resultados-unidade">
        @for (u of resultados(); track u.id) {
          <li class="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--line-100)] last:border-b-0">
            <span class="min-w-0 flex-1 text-sm truncate" [class.font-semibold]="u.id === selecionada()">{{ u.rotulo }}</span>
            <button type="button" class="ps-btn ps-btn-sec ps-btn-sm disabled:opacity-40" [disabled]="desabilitado()"
              [attr.aria-label]="acao() + ': ' + u.rotulo" (click)="escolher(u)">{{ u.id === selecionada() ? 'Escolhida' : acao() }}</button>
          </li>
        }
      </ul>
    } @else if (busca().trim()) {
      <p class="ps-cap mt-1.5">{{ buscando() ? 'Buscando…' : 'Nenhuma unidade encontrada.' }}</p>
    }
  `,
})
export class CentralBuscaUnidadeComponent {
  private readonly api = inject(CentralApi);

  readonly idCondominio = input<number | null>(null);
  /** Texto do botão de cada resultado ("Ligar", "Escolher"). */
  readonly acao = input('Escolher');
  readonly nome = input('busca-unidade-central');
  readonly rotuloBusca = input('Buscar unidade');
  readonly desabilitado = input(false);
  readonly selecionada = input<number | null>(null);
  readonly escolhida = output<UnidadeCentral>();

  readonly busca = signal('');
  readonly resultados = signal<UnidadeCentral[]>([]);
  readonly buscando = signal(false);
  readonly erro = signal<string | null>(null);
  private readonly termos = new Subject<{ id: number | null; t: string }>();

  constructor() {
    this.termos
      .pipe(
        debounceTime(250),
        switchMap(({ id, t }) => {
          if (!id || !t) return of([] as UnidadeCentral[]);
          this.buscando.set(true);
          return this.api.unidades(id, t).pipe(
            catchError(() => {
              this.erro.set('Não foi possível buscar as unidades.');
              return of([] as UnidadeCentral[]);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((l) => {
        this.buscando.set(false);
        this.resultados.set(Array.isArray(l) ? l : []);
      });
    // Trocou o condomínio: a busca recomeça.
    effect(() => {
      this.idCondominio();
      untracked(() => {
        this.busca.set('');
        this.resultados.set([]);
        this.erro.set(null);
      });
    });
  }

  buscar(valor: string): void {
    this.busca.set(valor);
    this.erro.set(null);
    this.termos.next({ id: this.idCondominio(), t: valor.trim() });
  }

  escolher(u: UnidadeCentral): void {
    this.escolhida.emit(u);
  }
}
