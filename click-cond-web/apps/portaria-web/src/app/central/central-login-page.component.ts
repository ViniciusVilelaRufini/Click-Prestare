import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ThemeService } from '../shared/theme.service';
import { CentralAuthService } from './central-auth.service';

/**
 * `/central/login`: entrada dos operadores da Central da Prestare. Senha → código de 6 dígitos por e-mail.
 * Sessão própria (`central_token`), separada do login do condomínio.
 */
@Component({
  selector: 'app-central-login-page',
  standalone: true,
  template: `
    <div class="fixed inset-0 overflow-y-auto app-bg font-sans flex items-center justify-center px-4 py-10">
      <section class="ps-panel w-full max-w-[420px]" aria-labelledby="titulo-central-login">
        <div class="px-6 pt-6 pb-4 border-b border-[var(--line-100)]">
          <div class="ps-brand">
            <img [src]="tema.isLight() ? '/prestare-marca-preta.svg' : '/prestare-marca-branca.svg'" alt="Prestare" />
            <div>
              <div class="ps-brand-wm">PRESTARE <span>CENTRAL</span></div>
              <div class="ps-label mt-1" style="font-size: 9px; line-height: 10px;">Operadores da portaria remota</div>
            </div>
          </div>
        </div>

        <div class="px-6 py-6 space-y-4">
          @if (etapa() === 'senha') {
            <div>
              <h1 id="titulo-central-login" class="ps-h2">Entrar na Central</h1>
              <p class="ps-cap mt-1">Use o e-mail cadastrado pela Prestare. Enviaremos um código para confirmar.</p>
            </div>
            <form class="space-y-3" (submit)="$event.preventDefault(); entrar()">
              <label class="block">
                <span class="ps-label">E-mail</span>
                <span class="ps-field mt-1.5">
                  <input type="email" name="email" autocomplete="username" required [value]="email()"
                    (input)="email.set($any($event.target).value)" aria-label="E-mail" />
                </span>
              </label>
              <label class="block">
                <span class="ps-label">Senha</span>
                <span class="ps-field mt-1.5">
                  <input type="password" name="senha" autocomplete="current-password" required [value]="senha()"
                    (input)="senha.set($any($event.target).value)" aria-label="Senha" />
                </span>
              </label>
              @if (erro()) {
                <p role="alert" class="text-sm text-[var(--signal-danger)]">{{ erro() }}</p>
              }
              <button type="submit" class="ps-btn w-full disabled:opacity-40" [disabled]="enviando() || !email().trim() || !senha()">
                {{ enviando() ? 'Entrando…' : 'Continuar' }}
              </button>
            </form>
          } @else {
            <div>
              <h1 id="titulo-central-login" class="ps-h2">Código de acesso</h1>
              <p class="ps-cap mt-1">Enviamos um código de 6 dígitos para {{ emailMascarado() }}.</p>
            </div>
            <form class="space-y-3" (submit)="$event.preventDefault(); confirmar()">
              <label class="block">
                <span class="ps-label">Código</span>
                <span class="ps-field mt-1.5">
                  <input type="text" name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required
                    [value]="codigo()" (input)="codigo.set($any($event.target).value)" aria-label="Código recebido por e-mail" />
                </span>
              </label>
              @if (erro()) {
                <p role="alert" class="text-sm text-[var(--signal-danger)]">{{ erro() }}</p>
              }
              <button type="submit" class="ps-btn w-full disabled:opacity-40" [disabled]="enviando() || codigo().trim().length < 6">
                {{ enviando() ? 'Confirmando…' : 'Entrar' }}
              </button>
              <button type="button" class="ps-btn ps-btn-ghost w-full" (click)="voltar()">Voltar</button>
            </form>
          }
        </div>
      </section>
    </div>
  `,
})
export class CentralLoginPageComponent implements OnInit {
  private readonly auth = inject(CentralAuthService);
  private readonly router = inject(Router);
  readonly tema = inject(ThemeService);

  readonly etapa = signal<'senha' | 'codigo'>('senha');
  readonly email = signal('');
  readonly senha = signal('');
  readonly codigo = signal('');
  readonly emailMascarado = signal('');
  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  private desafio = '';

  ngOnInit(): void {
    if (this.auth.sessaoValida()) void this.router.navigateByUrl('/central');
  }

  async entrar(): Promise<void> {
    if (this.enviando() || !this.email().trim() || !this.senha()) return;
    this.enviando.set(true);
    this.erro.set(null);
    try {
      const r = await firstValueFrom(this.auth.login(this.email(), this.senha()));
      this.desafio = r.desafio;
      this.emailMascarado.set(r.email_mascarado || 'o seu e-mail');
      this.senha.set('');
      this.codigo.set('');
      this.etapa.set('codigo');
    } catch (e) {
      this.erro.set(CentralAuthService.mensagemDeErro(e, 'login'));
    } finally {
      this.enviando.set(false);
    }
  }

  async confirmar(): Promise<void> {
    if (this.enviando() || this.codigo().trim().length < 6) return;
    this.enviando.set(true);
    this.erro.set(null);
    try {
      await firstValueFrom(this.auth.verificar(this.desafio, this.codigo()));
      await this.router.navigateByUrl('/central');
    } catch (e) {
      this.erro.set(CentralAuthService.mensagemDeErro(e, 'codigo'));
    } finally {
      this.enviando.set(false);
    }
  }

  voltar(): void {
    this.etapa.set('senha');
    this.codigo.set('');
    this.erro.set(null);
    this.desafio = '';
  }
}
