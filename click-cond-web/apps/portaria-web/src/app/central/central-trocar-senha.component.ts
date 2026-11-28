import { Component, inject, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CentralAuthService, SENHA_MIN } from './central-auth.service';

/**
 * Troca da senha temporária do operador (primeiro acesso). Até trocar, nenhuma rota da central nem o socket
 * aceitam o token. A API devolve um token novo: o CentralAuthService grava e o socket reconecta com ele.
 */
@Component({
  selector: 'app-central-trocar-senha',
  standalone: true,
  template: `
    <section class="ps-panel w-full max-w-[440px] mx-auto" aria-labelledby="titulo-trocar-senha">
      <div class="ps-panel-head">
        <h2 id="titulo-trocar-senha" class="ps-h2">Troque a senha temporária</h2>
      </div>
      <form class="px-5 py-5 space-y-3" (submit)="$event.preventDefault(); salvar()">
        <p class="ps-cap">Antes de atender, escolha uma senha sua com pelo menos {{ minimo }} caracteres.</p>
        <label class="block">
          <span class="ps-label">Senha atual</span>
          <span class="ps-field mt-1.5">
            <input type="password" name="senha-atual" autocomplete="current-password" [value]="atual()"
              (input)="atual.set($any($event.target).value)" aria-label="Senha atual" />
          </span>
        </label>
        <label class="block">
          <span class="ps-label">Senha nova</span>
          <span class="ps-field mt-1.5">
            <input type="password" name="senha-nova" autocomplete="new-password" [value]="nova()"
              (input)="nova.set($any($event.target).value)" aria-label="Senha nova" />
          </span>
        </label>
        <label class="block">
          <span class="ps-label">Repita a senha nova</span>
          <span class="ps-field mt-1.5">
            <input type="password" name="senha-confirma" autocomplete="new-password" [value]="confirma()"
              (input)="confirma.set($any($event.target).value)" aria-label="Repita a senha nova" />
          </span>
        </label>
        @if (erro()) {
          <p role="alert" class="text-sm text-[var(--signal-danger)]">{{ erro() }}</p>
        }
        <button type="submit" class="ps-btn w-full disabled:opacity-40" [disabled]="salvando()">
          {{ salvando() ? 'Salvando…' : 'Salvar e entrar' }}
        </button>
      </form>
    </section>
  `,
})
export class CentralTrocarSenhaComponent {
  private readonly auth = inject(CentralAuthService);
  readonly trocada = output<void>();
  readonly minimo = SENHA_MIN;

  readonly atual = signal('');
  readonly nova = signal('');
  readonly confirma = signal('');
  readonly salvando = signal(false);
  readonly erro = signal<string | null>(null);

  async salvar(): Promise<void> {
    if (this.salvando()) return;
    if (!this.atual()) return this.erro.set('Informe a senha atual (a temporária que você recebeu).');
    if (this.nova().length < SENHA_MIN) return this.erro.set(`A senha nova precisa ter pelo menos ${SENHA_MIN} caracteres.`);
    if (this.nova() !== this.confirma()) return this.erro.set('As duas senhas novas não são iguais.');
    if (this.nova() === this.atual()) return this.erro.set('A senha nova precisa ser diferente da atual.');
    this.salvando.set(true);
    this.erro.set(null);
    try {
      await firstValueFrom(this.auth.trocarSenha(this.atual(), this.nova()));
      this.atual.set('');
      this.nova.set('');
      this.confirma.set('');
      this.trocada.emit();
    } catch (e) {
      // 401: a sessão acabou (operador desativado ou outra troca derrubou esta) — volta ao login.
      if ((e as { status?: number })?.status === 401) {
        this.auth.logout();
        return;
      }
      this.erro.set(CentralAuthService.mensagemDeErro(e, 'senha'));
    } finally {
      this.salvando.set(false);
    }
  }
}
