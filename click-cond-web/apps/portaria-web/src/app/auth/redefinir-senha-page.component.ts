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
    >
      <div class="w-full max-w-md mx-auto space-y-6">

        <!-- Marca Prestare -->
        <div class="ps-brand justify-center">
          <img [src]="isLight() ? '/prestare-marca-preta.svg' : '/prestare-marca-branca.svg'" alt="Prestare Gestão" />
          <div>
            <div class="ps-brand-wm">PRESTARE <span>GESTÃO</span></div>
            <div class="ps-label mt-1" style="font-size: 9px; line-height: 10px;">Recuperação de Acesso</div>
          </div>
        </div>

        @if (semToken()) {
          <!-- Token ausente ou inválido -->
          <div class="ps-panel p-8 text-center space-y-4">
            <div class="w-12 h-12 mx-auto border text-slate-300 flex items-center justify-center" style="border-color: var(--line-200)">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 class="ps-h1">Link Incompleto ou Inválido</h2>
            <p class="text-sm text-slate-400">
              O link de redefinição não contém um código de autorização válido. Por favor, solicite uma nova redefinição através do aplicativo ou tela de login.
            </p>
            <div class="pt-2">
              <a
                routerLink="/login"
                class="ps-btn"
              >
                Ir para o Login
              </a>
            </div>
          </div>
        } @else if (sucesso()) {
          <!-- Sucesso -->
          <div class="ps-panel p-8 text-center space-y-4">
            <div class="w-14 h-14 mx-auto border text-slate-300 flex items-center justify-center" style="border-color: var(--line-200)">
              <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 class="ps-h1">Senha Redefinida com Sucesso!</h2>
            <p class="text-sm text-slate-300">
              {{ mensagemSucesso() || 'Sua nova senha foi gravada com segurança. Você já pode acessar o sistema com as novas credenciais.' }}
            </p>
            <div class="pt-4 flex flex-col gap-3">
              <a
                routerLink="/login"
                class="ps-btn ps-btn-lg w-full"
              >
                Acessar o Painel Web
              </a>
              @if (deepLink()) {
                <a
                  [href]="deepLink()"
                  class="ps-btn ps-btn-sec w-full"
                >
                  Abrir no Aplicativo PRESTARE
                </a>
              }
            </div>
          </div>
        } @else {
          <!-- Formulário de Nova Senha -->
          <div class="ps-panel p-6 sm:p-8 space-y-5">
            <div class="space-y-1">
              <h2 class="ps-h1">Crie sua Nova Senha</h2>
              <p class="text-xs text-slate-400">
                Digite uma senha segura com no mínimo 6 caracteres. O link é de uso único e expira em 30 minutos.
              </p>
            </div>

            @if (erro()) {
              <div class="p-3.5 border text-red-400 text-xs flex items-start gap-2.5" style="border-color: var(--line-200)" role="alert">
                <span class="ps-dot ps-dot-danger mt-1.5"></span>
                <span>{{ erro() }}</span>
              </div>
            }

            <form (ngSubmit)="salvar()" class="space-y-4">
              <!-- Nova Senha -->
              <div class="space-y-1.5">
                <label class="ps-label block">Nova Senha</label>
                <div class="ps-field">
                  <input
                    [type]="mostrarNova() ? 'text' : 'password'"
                    [(ngModel)]="novaSenha"
                    name="novaSenha"
                    placeholder="Mínimo 6 caracteres"
                    autocomplete="new-password"
                  />
                  <button
                    type="button"
                    (click)="mostrarNova.set(!mostrarNova())"
                    class="ps-ibtn -mr-2 shrink-0"
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
                <label class="ps-label block">Confirmar Nova Senha</label>
                <div class="ps-field">
                  <input
                    [type]="mostrarConfirmar() ? 'text' : 'password'"
                    [(ngModel)]="confirmarSenha"
                    name="confirmarSenha"
                    placeholder="Repita a nova senha"
                    autocomplete="new-password"
                  />
                  <button
                    type="button"
                    (click)="mostrarConfirmar.set(!mostrarConfirmar())"
                    class="ps-ibtn -mr-2 shrink-0"
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
                class="ps-btn ps-btn-lg w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                @if (salvando()) {
                  <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
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
                  class="text-xs text-white underline transition-colors"
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
    const fromQuery =
      this.route.snapshot.queryParamMap.get('redefinir-senha') ||
      this.route.snapshot.queryParamMap.get('redefinir_senha') ||
      this.route.snapshot.queryParamMap.get('token');
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
