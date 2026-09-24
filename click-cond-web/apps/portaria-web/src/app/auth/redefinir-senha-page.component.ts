import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { API_BASE } from '../shared/api.config';
import { ThemeService } from '../shared/theme.service';

@Component({
  selector: 'app-redefinir-senha-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div
      class="min-h-screen app-bg font-sans transition-colors duration-500 px-4 py-8 sm:py-12 flex flex-col justify-center items-center"
      [ngClass]="isLight() ? 'light' : ''"
    >
      <div class="w-full max-w-md mx-auto space-y-6">

        <!-- Marca Prestare -->
        <div class="flex items-center justify-center gap-2.5">
          <div class="w-10 h-10 rounded-xl bg-white p-1 flex items-center justify-center ring-1 ring-accent/10 shadow-md shadow-accent/15 shrink-0">
            <img src="/logo-prestare-gestao.png" alt="Prestare Gestão" class="w-full h-full object-cover rounded-lg" />
          </div>
          <div class="min-w-0 leading-none">
            <span class="text-lg font-extrabold tracking-tight uppercase text-white block">
              PRESTARE<span class="text-accent"> GESTÃO</span>
            </span>
            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1 block">
              Recuperação de Acesso
            </span>
          </div>
        </div>

        @if (semToken()) {
          <!-- Token ausente ou inválido -->
          <div class="rounded-2xl bg-graphite-200 border border-white/10 p-8 text-center space-y-4 shadow-xl">
            <div class="w-12 h-12 mx-auto rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 class="text-lg font-bold text-white">Link Incompleto ou Inválido</h2>
            <p class="text-sm text-slate-400">
              O link de redefinição não contém um código de autorização válido. Por favor, solicite uma nova redefinição através do aplicativo ou tela de login.
            </p>
            <div class="pt-2">
              <a
                routerLink="/login"
                class="inline-block px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-dark transition-colors"
              >
                Ir para o Login
              </a>
            </div>
          </div>
        } @else if (sucesso()) {
          <!-- Sucesso -->
          <div class="rounded-2xl bg-graphite-200 border border-emerald-500/30 p-8 text-center space-y-4 shadow-xl">
            <div class="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 class="text-xl font-bold text-white">Senha Redefinida com Sucesso!</h2>
            <p class="text-sm text-slate-300">
              {{ mensagemSucesso() || 'Sua nova senha foi gravada com segurança. Você já pode acessar o sistema com as novas credenciais.' }}
            </p>
            <div class="pt-4 flex flex-col gap-3">
              <a
                routerLink="/login"
                class="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-dark transition-colors block text-center"
              >
                Acessar o Painel Web
              </a>
              @if (deepLink()) {
                <a
                  [href]="deepLink()"
                  class="w-full py-2.5 rounded-xl bg-graphite-300 hover:bg-graphite-400 text-slate-300 text-xs font-medium transition-colors block text-center border border-white/5"
                >
                  Abrir no Aplicativo PRESTARE
                </a>
              }
            </div>
          </div>
        } @else {
          <!-- Formulário de Nova Senha -->
          <div class="rounded-2xl bg-graphite-200 border border-white/10 p-6 sm:p-8 space-y-5 shadow-xl">
            <div class="space-y-1">
              <h2 class="text-lg font-bold text-white">Crie sua Nova Senha</h2>
              <p class="text-xs text-slate-400">
                Digite uma senha segura com no mínimo 6 caracteres. O link é de uso único e expira em 30 minutos.
              </p>
            </div>

            @if (erro()) {
              <div class="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5">
                <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{{ erro() }}</span>
              </div>
            }

            <form (ngSubmit)="salvar()" class="space-y-4">
              <!-- Nova Senha -->
              <div class="space-y-1.5">
                <label class="text-xs font-semibold text-slate-300">Nova Senha</label>
                <div class="relative">
                  <input
                    [type]="mostrarNova() ? 'text' : 'password'"
                    [(ngModel)]="novaSenha"
                    name="novaSenha"
                    placeholder="Mínimo 6 caracteres"
                    autocomplete="new-password"
                    class="w-full rounded-xl bg-graphite-300 border border-white/10 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent transition-colors"
                  />
                  <button
                    type="button"
                    (click)="mostrarNova.set(!mostrarNova())"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                  >
                    @if (mostrarNova()) {
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    } @else {
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    }
                  </button>
                </div>
              </div>

              <!-- Confirmar Nova Senha -->
              <div class="space-y-1.5">
                <label class="text-xs font-semibold text-slate-300">Confirmar Nova Senha</label>
                <div class="relative">
                  <input
                    [type]="mostrarConfirmar() ? 'text' : 'password'"
                    [(ngModel)]="confirmarSenha"
                    name="confirmarSenha"
                    placeholder="Repita a nova senha"
                    autocomplete="new-password"
                    class="w-full rounded-xl bg-graphite-300 border border-white/10 px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent transition-colors"
                  />
                  <button
                    type="button"
                    (click)="mostrarConfirmar.set(!mostrarConfirmar())"
                    class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                  >
                    @if (mostrarConfirmar()) {
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    } @else {
                      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    }
                  </button>
                </div>
              </div>

              <button
                type="submit"
                [disabled]="salvando()"
                class="w-full py-3.5 rounded-xl bg-accent text-white text-sm font-bold hover:bg-accent-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-accent/20 flex items-center justify-center gap-2"
              >
                @if (salvando()) {
                  <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Gravando Nova Senha...</span>
                } @else {
                  <span>Salvar Nova Senha</span>
                }
              </button>
            </form>

            @if (deepLink()) {
              <div class="pt-4 border-t border-white/5 text-center">
                <a
                  [href]="deepLink()"
                  class="text-xs text-accent hover:text-accent-light underline transition-colors"
                >
                  Prefere abrir no aplicativo móvel PRESTARE? Clique aqui
                </a>
              </div>
            }
          </div>
        }

      </div>
    </div>
  `,
})
export class RedefinirSenhaPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly theme = inject(ThemeService);

  readonly token = signal<string>('');
  readonly semToken = signal<boolean>(false);
  readonly novaSenha = signal<string>('');
  readonly confirmarSenha = signal<string>('');
  readonly mostrarNova = signal<boolean>(false);
  readonly mostrarConfirmar = signal<boolean>(false);
  readonly salvando = signal<boolean>(false);
  readonly sucesso = signal<boolean>(false);
  readonly mensagemSucesso = signal<string>('');
  readonly erro = signal<string | null>(null);

  get isLight(): () => boolean {
    return this.theme.isLight;
  }

  get deepLink(): () => string {
    return () => this.token() ? `clickprestare://redefinir-senha?token=${encodeURIComponent(this.token())}` : '';
  }

  ngOnInit(): void {
    const fromQuery = this.route.snapshot.queryParamMap.get('token');
    const fromParam = this.route.snapshot.paramMap.get('token');
    const t = (fromQuery || fromParam || '').trim();

    if (!t) {
      this.semToken.set(true);
      return;
    }

    this.token.set(t);
  }

  salvar(): void {
    this.erro.set(null);
    const pass = this.novaSenha().trim();
    const conf = this.confirmarSenha().trim();

    if (pass.length < 6) {
      this.erro.set('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    if (pass !== conf) {
      this.erro.set('A nova senha e a confirmação não conferem.');
      return;
    }

    this.salvando.set(true);

    const url = `${API_BASE}/auth/redefinir-senha`;
    this.http.post<{ success: boolean; message: string }>(url, {
      token: this.token(),
      nova_senha: pass,
    }).subscribe({
      next: (res) => {
        this.salvando.set(false);
        this.sucesso.set(true);
        this.mensagemSucesso.set(res?.message || 'Senha alterada com sucesso!');
      },
      error: (err) => {
        this.salvando.set(false);
        const msg = err?.error?.message || err?.message || 'Falha ao redefinir senha. Link pode estar expirado ou inválido.';
        this.erro.set(msg);
      },
    });
  }
}
