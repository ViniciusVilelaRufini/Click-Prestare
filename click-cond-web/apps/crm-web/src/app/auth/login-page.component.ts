import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-crm-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen bg-surface-page p-4 text-ink lg:p-6">
      <div class="mx-auto grid min-h-[calc(100vh-2rem)] max-w-shell overflow-hidden rounded-3xl bg-surface-raised shadow-card lg:min-h-[calc(100vh-3rem)] lg:grid-cols-2">
        <!-- Lado institucional -->
        <div class="relative hidden flex-col justify-between overflow-hidden bg-accent p-12 text-white lg:flex">
          <!-- Halo decorativo -->
          <div class="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" aria-hidden="true"></div>
          <div class="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/5" aria-hidden="true"></div>

          <div class="relative flex items-center gap-3">
            <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15" aria-hidden="true">
              <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
              </svg>
            </div>
            <span class="font-display text-lg font-bold tracking-tight">CLICK PRESTARE</span>
          </div>

          <div class="relative">
            <p class="mb-4 text-2xs font-semibold uppercase tracking-widest text-white/70">Painel comercial</p>
            <h1 class="font-display text-display-lg font-semibold leading-tight">CRM comercial<br />da operadora</h1>
            <p class="mt-5 max-w-md leading-relaxed text-white/80">
              Visão consolidada de todos os condomínios-cliente: receita recorrente, saúde
              das contas, inadimplência e alertas — em um só lugar.
            </p>
          </div>

          <p class="relative text-xs text-white/60">© 2026 Prestare Gestão e Tecnologia. Acesso restrito.</p>
        </div>

        <!-- Formulário -->
        <div class="flex items-center justify-center p-8 sm:p-12">
          <div class="w-full max-w-sm">
            <div class="mb-8 flex items-center gap-3 lg:hidden">
              <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent font-display text-lg font-bold text-white">C</div>
              <span class="font-display text-lg font-bold tracking-tight">CLICK <span class="text-accent">PRESTARE</span></span>
            </div>

            <h2 class="font-display text-display-sm font-semibold tracking-tight">Acesso administrativo</h2>
            <p class="mt-1 text-sm text-ink-muted">Entre com as credenciais de administrador do CRM.</p>

            <form (ngSubmit)="entrar()" class="mt-8 space-y-4">
              <div>
                <label for="login-input" class="eyebrow mb-1.5 block">Login</label>
                <input
                  id="login-input"
                  name="login"
                  [(ngModel)]="login"
                  autocomplete="username"
                  [attr.aria-invalid]="erro() ? true : null"
                  class="input min-h-[46px]"
                  placeholder="admin@clickprestare.com.br" />
              </div>
              <div>
                <label for="senha-input" class="eyebrow mb-1.5 block">Senha</label>
                <input
                  id="senha-input"
                  name="senha"
                  type="password"
                  [(ngModel)]="senha"
                  autocomplete="current-password"
                  [attr.aria-invalid]="erro() ? true : null"
                  class="input min-h-[46px]"
                  placeholder="••••••••" />
              </div>

              @if (erro()) {
                <div role="alert" class="flex items-center gap-2.5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger animate-fade-in">
                  <svg class="h-4 w-4 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                  </svg>
                  {{ erro() }}
                </div>
              }

              <button type="submit" [disabled]="carregando()" class="btn-primary press min-h-[46px] w-full">
                @if (carregando()) {
                  <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Entrando…
                } @else {
                  Entrar no painel
                }
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class LoginPageComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  login = '';
  senha = '';
  readonly erro = signal<string | null>(null);
  readonly carregando = signal(false);

  entrar(): void {
    if (!this.login.trim() || !this.senha) {
      this.erro.set('Informe login e senha.');
      return;
    }
    this.erro.set(null);
    this.carregando.set(true);
    this.auth.login(this.login.trim(), this.senha).subscribe({
      next: () => {
        this.carregando.set(false);
        this.router.navigate(['/painel']);
      },
      error: (e) => {
        this.carregando.set(false);
        this.erro.set(e?.error?.message || 'Login ou senha incorretos.');
      },
    });
  }
}
