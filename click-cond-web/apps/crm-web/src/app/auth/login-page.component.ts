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
    <div class="grid min-h-screen bg-surface-page text-ink lg:grid-cols-2">
      <!-- Lado institucional -->
      <div class="hidden flex-col justify-between bg-accent p-12 text-white lg:flex">
        <div class="flex items-center gap-3">
          <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15" aria-hidden="true">
            <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
            </svg>
          </div>
          <span class="font-display text-lg font-extrabold tracking-tight">CLICK PRESTARE</span>
        </div>

        <div>
          <p class="mb-4 text-xs font-bold uppercase tracking-widest text-white/70">Painel comercial</p>
          <h1 class="font-display text-4xl font-extrabold leading-tight">CRM comercial<br />da operadora</h1>
          <p class="mt-5 max-w-md leading-relaxed text-white/80">
            Visão consolidada de todos os condomínios-cliente: receita recorrente, saúde
            das contas, inadimplência e alertas — em um só lugar.
          </p>
        </div>

        <p class="text-xs text-white/60">© 2026 Prestare Gestão e Tecnologia. Acesso restrito.</p>
      </div>

      <!-- Formulário -->
      <div class="flex items-center justify-center p-8">
        <div class="w-full max-w-sm">
          <div class="mb-8 flex items-center gap-3 lg:hidden">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-border bg-accent-soft font-extrabold text-accent">C</div>
            <span class="font-display text-lg font-extrabold tracking-tight">CLICK <span class="text-accent">PRESTARE</span></span>
          </div>

          <h2 class="font-display text-2xl font-bold tracking-tight">Acesso administrativo</h2>
          <p class="mt-1 text-sm text-ink-soft">Entre com as credenciais de administrador do CRM.</p>

          <form (ngSubmit)="entrar()" class="mt-8 space-y-4">
            <div>
              <label for="login-input" class="stat-label mb-1.5 block">Login</label>
              <input
                id="login-input"
                name="login"
                [(ngModel)]="login"
                autocomplete="username"
                [attr.aria-invalid]="erro() ? true : null"
                class="input min-h-[44px]"
                placeholder="admin@clickprestare.com.br" />
            </div>
            <div>
              <label for="senha-input" class="stat-label mb-1.5 block">Senha</label>
              <input
                id="senha-input"
                name="senha"
                type="password"
                [(ngModel)]="senha"
                autocomplete="current-password"
                [attr.aria-invalid]="erro() ? true : null"
                class="input min-h-[44px]"
                placeholder="••••••••" />
            </div>

            @if (erro()) {
              <div role="alert" class="flex items-center gap-2 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger animate-fade-in">
                <svg class="h-4 w-4 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
                {{ erro() }}
              </div>
            }

            <button type="submit" [disabled]="carregando()" class="btn-primary press min-h-[44px] w-full">
              {{ carregando() ? 'Entrando…' : 'Entrar no painel' }}
            </button>
          </form>
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
