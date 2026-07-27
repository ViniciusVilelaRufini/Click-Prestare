import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { ThemeService } from '../shared/theme.service';

/**
 * Escolha do condomínio ativo para síndico que administra mais de um.
 *
 * Antes a web entrava sempre no primeiro vínculo, sem perguntar — quem tinha
 * dois ou mais condomínios não conseguia acessar os demais. Serve tanto ao
 * pós-login quanto à troca pela barra lateral.
 */
@Component({
  selector: 'app-selecionar-condominio',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="min-h-screen app-bg flex items-center justify-center p-6 font-sans transition-colors duration-500"
      [ngClass]="isLight() ? 'light' : ''"
    >
      <div class="w-full max-w-md">
        <div class="flex items-center gap-3 mb-8">
          <div
            class="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center"
          >
            <svg
              class="w-6 h-6 text-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
          <div>
            <h1
              class="text-xl font-bold"
              [ngClass]="isLight() ? 'text-slate-900' : 'text-white'"
            >
              Escolha o condomínio
            </h1>
            <p
              class="text-sm"
              [ngClass]="isLight() ? 'text-slate-500' : 'text-slate-400'"
            >
              Você administra mais de um. Selecione em qual deseja entrar.
            </p>
          </div>
        </div>

        @if (erro()) {
          <div
            class="mb-4 px-4 py-3 rounded-xl text-sm bg-red-500/10 border border-red-500/30 text-red-500"
          >
            {{ erro() }}
          </div>
        }

        <div class="space-y-2">
          @for (cond of condominios(); track cond.id) {
            <button
              type="button"
              (click)="escolher(cond.id)"
              [disabled]="carregandoId() !== null"
              class="w-full text-left px-4 py-4 rounded-xl border flex items-center justify-between gap-3 transition-all active:scale-[0.99] disabled:opacity-60"
              [ngClass]="
                isLight()
                  ? 'bg-white border-slate-200 hover:border-accent/50 hover:bg-slate-50'
                  : 'bg-white/[0.03] border-white/10 hover:border-accent/40 hover:bg-white/[0.06]'
              "
            >
              <div class="flex items-center gap-3 min-w-0">
                <span
                  class="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center shrink-0 text-sm font-bold"
                >
                  {{ cond.nome.charAt(0).toUpperCase() }}
                </span>
                <span
                  class="font-semibold truncate"
                  [ngClass]="isLight() ? 'text-slate-800' : 'text-slate-100'"
                >
                  {{ cond.nome }}
                </span>
              </div>

              @if (carregandoId() === cond.id) {
                <span
                  class="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0"
                ></span>
              } @else {
                <svg
                  class="w-4 h-4 shrink-0"
                  [ngClass]="isLight() ? 'text-slate-400' : 'text-slate-500'"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              }
            </button>
          }
        </div>

        <button
          type="button"
          (click)="sair()"
          class="mt-6 w-full text-center text-sm transition-colors"
          [ngClass]="
            isLight()
              ? 'text-slate-500 hover:text-slate-700'
              : 'text-slate-500 hover:text-slate-300'
          "
        >
          Sair da conta
        </button>
      </div>
    </div>
  `,
})
export class SelecionarCondominioComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);

  readonly isLight = this.theme.isLight;
  readonly condominios = this.auth.condominios;
  readonly carregandoId = signal<number | null>(null);
  readonly erro = signal('');

  constructor() {
    // Sem múltiplos vínculos não há o que escolher (ex.: porteiro, ou síndico
    // de um só condomínio que chegou aqui pela URL).
    if (this.condominios().length <= 1) {
      this.router.navigate(['/dashboard']);
    }
  }

  escolher(id: number) {
    if (this.carregandoId() !== null) return;
    this.carregandoId.set(id);
    this.erro.set('');

    this.auth.selecionarCondominio(id).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        this.carregandoId.set(null);
        this.erro.set(
          err.status === 401
            ? 'Você não administra este condomínio.'
            : 'Falha ao entrar no condomínio. Tente novamente.',
        );
      },
    });
  }

  sair() {
    this.auth.logout();
  }
}
