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
    <div class="min-h-screen grid lg:grid-cols-2 bg-graphite text-slate-100">
      <!-- Lado institucional -->
      <div class="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-graphite-200 to-graphite">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-md bg-accent/15 border border-accent/30 flex items-center justify-center" aria-hidden="true">
            <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
            </svg>
          </div>
          <span class="font-display font-extrabold tracking-tight text-lg">PRESTARE <span class="text-accent-400">CLICK</span></span>
        </div>
        <div>
          <p class="text-[11px] font-bold uppercase tracking-widest text-accent-400 mb-4">Painel Comercial</p>
          <h1 class="text-4xl font-display font-extrabold leading-tight">
            CRM <span class="text-accent-400">Comercial</span><br />da operadora
          </h1>
          <p class="mt-5 text-slate-400 max-w-md leading-relaxed">
            Visão consolidada de todos os condomínios-cliente: receita recorrente, saúde
            das contas, inadimplência e alertas — em um só lugar.
          </p>
        </div>
        <p class="text-xs text-slate-600">© 2026 Prestare Gestão e Tecnologia. Acesso restrito.</p>
      </div>

      <!-- Formulário -->
      <div class="flex items-center justify-center p-8">
        <div class="w-full max-w-sm">
          <div class="lg:hidden flex items-center gap-3 mb-8">
            <span class="font-display font-extrabold tracking-tight text-lg">PRESTARE <span class="text-accent-400">CLICK</span></span>
          </div>

          <h2 class="text-2xl font-display font-bold">Acesso administrativo</h2>
          <p class="text-sm text-slate-400 mt-1">Entre com as credenciais de administrador do CRM.</p>

          <form (ngSubmit)="entrar()" class="mt-8 space-y-4">
            <div>
              <label for="login-input" class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Login</label>
              <input
                id="login-input"
                name="login"
                [(ngModel)]="login"
                autocomplete="username"
                [attr.aria-invalid]="erro() ? true : null"
                class="w-full px-4 py-3 min-h-[44px] rounded-md bg-graphite-200 border border-white/10 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none transition text-sm"
                placeholder="admin@clickprestare.com.br" />
            </div>
            <div>
              <label for="senha-input" class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Senha</label>
              <input
                id="senha-input"
                name="senha"
                type="password"
                [(ngModel)]="senha"
                autocomplete="current-password"
                [attr.aria-invalid]="erro() ? true : null"
                class="w-full px-4 py-3 min-h-[44px] rounded-md bg-graphite-200 border border-white/10 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 outline-none transition text-sm"
                placeholder="••••••••" />
            </div>

            @if (erro()) {
              <div role="alert" class="flex items-center gap-2 px-4 py-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
                <svg class="w-4 h-4 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
                {{ erro() }}
              </div>
            }

            <button
              type="submit"
              [disabled]="carregando()"
              class="w-full min-h-[44px] py-3 rounded-md bg-accent-500 hover:bg-accent-600 disabled:opacity-60 disabled:cursor-not-allowed font-semibold text-white transition shadow-glow">
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
