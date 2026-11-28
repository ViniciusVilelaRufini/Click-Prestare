import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { Apartamento, ApartamentosApi } from '../apartamentos/apartamentos.service';
import { rotuloUnidade } from '../shared/bloco-label.util';
import { InterfoneStore } from './interfone.store';
import { UnidadeFrequente, frequentes } from './interfone-lista';

const MAX_RESULTADOS = 5;

/**
 * "Ligar para a unidade": busca a unidade e liga pelo interfone (toca nos celulares dos moradores e nos monitores
 * IP). Só áudio; quem atende primeiro leva. Ninguém atende → o painel mostra "Ninguém atendeu".
 */
@Component({
  selector: 'app-ligar-unidade',
  standalone: true,
  host: { class: 'block' },
  template: `
    <section class="ps-panel" aria-labelledby="titulo-ligar-unidade">
      <div class="ps-panel-head">
        <h2 id="titulo-ligar-unidade" class="ps-h2">Ligar para a unidade</h2>
        <span class="ps-cap">Interfone pelo app</span>
      </div>
      <div class="px-4 py-3 space-y-2">
        <label class="ps-field">
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.2-5.2M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"/></svg>
          <input
            type="search"
            name="busca-unidade-interfone"
            placeholder="Bloco ou apartamento"
            autocomplete="off"
            aria-label="Buscar unidade para ligar"
            [value]="busca()"
            (input)="buscar($any($event.target).value)"
          />
        </label>
        @if (erro()) {
          <p role="alert" class="text-sm text-[var(--ink-muted)]">{{ erro() }}</p>
        }
        @if (resultados().length) {
        <div class="max-h-[11rem] overflow-y-auto" data-teste="resultados-ligar">
        @for (a of resultados(); track a.id) {
          <div class="flex items-center gap-3 py-1.5 border-b border-[var(--line-100)] last:border-b-0">
            <p class="min-w-0 flex-1 text-sm font-medium truncate">{{ rotulo(a) }}</p>
            <button
              type="button"
              class="ps-btn ps-btn-sec ps-btn-sm disabled:opacity-40"
              [disabled]="ocupado()"
              (click)="ligar(a)"
            >Ligar</button>
          </div>
        }
        </div>
        } @else if (busca().trim()) {
          <p class="ps-cap py-1">{{ buscando() ? 'Buscando…' : 'Nenhuma unidade encontrada.' }}</p>
        }
      </div>
      @if (!busca().trim()) {
        @if (frequentes().length) {
          <div class="border-t border-[var(--line-100)]" data-teste="frequentes">
            <p class="ps-label px-4 pt-3 pb-1">Mais chamadas hoje</p>
            @for (u of frequentes(); track u.id_apartamento) {
              <div class="flex items-center gap-3 px-4 py-2 border-b border-[var(--line-100)] last:border-b-0">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium truncate">{{ u.unidade }}</p>
                  <p class="ps-cap">{{ u.total }} {{ u.total === 1 ? 'chamada' : 'chamadas' }}</p>
                </div>
                <button type="button" class="ps-btn ps-btn-sec ps-btn-sm disabled:opacity-40" [disabled]="ocupado()"
                  [attr.aria-label]="'Ligar para ' + u.unidade" (click)="ligarFrequente(u)">Ligar</button>
              </div>
            }
          </div>
        } @else {
          <p class="ps-cap px-4 pb-4" data-teste="dica-ligar">Digite o bloco ou o número do apartamento. O interfone toca no celular dos moradores e nos monitores da unidade.</p>
        }
      }
    </section>
  `,
})
export class LigarUnidadeComponent {
  readonly store = inject(InterfoneStore);
  private readonly aptos = inject(ApartamentosApi);

  readonly busca = signal('');
  readonly resultados = signal<Apartamento[]>([]);
  readonly buscando = signal(false);
  readonly erro = signal<string | null>(null);
  /** Com a busca vazia: as unidades mais chamadas hoje, para ligar com um clique. */
  readonly frequentes = computed(() => frequentes(this.store.hoje()));
  readonly ocupado = computed(() => !!this.store.emChamada() || this.store.discando() || this.store.atendendo() !== null);
  private readonly termos = new Subject<string>();

  constructor() {
    this.termos
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((t) => {
          if (!t) return of([] as Apartamento[]);
          this.buscando.set(true);
          return this.aptos.list(t).pipe(
            catchError(() => {
              this.erro.set('Não foi possível buscar as unidades.');
              return of([] as Apartamento[]);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((lista) => {
        this.buscando.set(false);
        this.resultados.set((Array.isArray(lista) ? lista : []).slice(0, MAX_RESULTADOS));
      });
  }

  buscar(valor: string): void {
    this.busca.set(valor);
    this.erro.set(null);
    const t = valor.trim();
    if (!t) this.resultados.set([]);
    this.termos.next(t);
  }

  rotulo(a: Apartamento): string {
    return rotuloUnidade(a.bloco, a.apto);
  }

  ligarFrequente(u: UnidadeFrequente): void {
    void this.store.ligar(u.id_apartamento, u.unidade);
  }

  ligar(a: Apartamento): void {
    void this.store.ligar(a.id, this.rotulo(a));
  }
}
