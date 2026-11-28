import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CentralOperadoresApi, OperadorCentral } from '../interfone.service';
import { ToastService } from '../../shared/toast.service';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';

function mensagem(e: any, padrao: string): string {
  const m = e?.error?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && m.length) return m.join(' ');
  return padrao;
}

/**
 * Aba "Operadores da central": cadastro de quem atende na Central Prestare. A senha temporária aparece uma vez
 * (ao criar ou gerar nova senha), com botão copiar; o operador troca no primeiro login. Desativar ou gerar nova
 * senha derruba as sessões abertas do operador.
 */
@Component({
  selector: 'crm-central-operadores',
  standalone: true,
  imports: [EmptyStateComponent, DatePipe],
  template: `
    <div class="animate-fade-in space-y-5">
      <div>
        <h2 class="section-title text-xl">Operadores da central</h2>
        <p class="mt-0.5 text-sm text-ink-muted">
          Quem atende as portarias na Central Prestare. Login em /central com código por e-mail.
        </p>
      </div>

      @if (senhaMostrada(); as s) {
        <div class="card space-y-3 p-5" role="status" data-senha-temporaria>
          <p class="text-sm text-ink">
            Senha temporária de <strong>{{ s.nome }}</strong>. Ela aparece só agora: copie e entregue ao operador.
          </p>
          <p class="select-all rounded-xl bg-surface-sunken px-4 py-2.5 font-mono text-base tracking-wider text-ink">{{ s.senha }}</p>
          <div class="flex gap-2">
            <button type="button" class="btn-secondary btn-sm press" data-copiar-senha (click)="copiar()">Copiar</button>
            <button type="button" class="btn-ghost btn-sm press" data-fechar-senha (click)="senhaMostrada.set(null)">Já copiei</button>
          </div>
        </div>
      }

      <div class="card space-y-3 p-5">
        <h3 class="section-title text-sm">Novo operador</h3>
        <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            type="text"
            class="input"
            placeholder="Nome"
            maxlength="120"
            aria-label="Nome do operador"
            data-novo-nome
            [value]="novoNome()"
            (input)="novoNome.set($any($event.target).value)"
          />
          <input
            type="email"
            class="input"
            placeholder="E-mail"
            maxlength="190"
            aria-label="E-mail do operador"
            data-novo-email
            [value]="novoEmail()"
            (input)="novoEmail.set($any($event.target).value)"
          />
          <button
            type="button"
            class="btn-primary btn-sm press"
            data-criar
            [disabled]="criando() || !novoNome().trim() || !novoEmail().trim()"
            (click)="criar()"
          >
            {{ criando() ? 'Criando…' : 'Criar operador' }}
          </button>
        </div>
      </div>

      @if (erro()) {
        <div class="card p-5" role="alert">
          <p class="text-sm text-ink-muted">{{ erro() }}</p>
          <button type="button" class="btn-secondary btn-sm press mt-3" (click)="carregar()">Tentar de novo</button>
        </div>
      } @else if (carregando()) {
        <div class="card p-6 text-sm text-ink-soft">Carregando…</div>
      } @else {
        <div class="card overflow-hidden">
          @if (operadores().length === 0) {
            <app-empty-state icone="pessoas" titulo="Nenhum operador" descricao="Cadastre o primeiro operador da central." />
          }
          <ul class="space-y-1 p-3">
            @for (o of operadores(); track o.id) {
              <li class="flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 hover:bg-surface-sunken">
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-ink">{{ o.nome }}</span>
                  <span class="block truncate text-xs text-ink-muted">
                    {{ o.email }}
                    @if (o.ultimo_acesso) { · último acesso {{ o.ultimo_acesso | date: 'dd/MM/yyyy HH:mm' }} }
                    @if (o.trocar_senha) { · <span class="text-warning">troca de senha pendente</span> }
                  </span>
                </span>
                <span class="flex items-center gap-3">
                  <label class="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                    <input
                      #caixa
                      type="checkbox"
                      [attr.data-ativo]="o.id"
                      [checked]="o.ativo"
                      [disabled]="alterando() === o.id"
                      (change)="alternarAtivo(o, caixa)"
                    />
                    Ativo
                  </label>
                  <button
                    type="button"
                    class="btn-ghost btn-sm press"
                    [attr.data-nova-senha]="o.id"
                    [disabled]="alterando() === o.id"
                    (click)="novaSenha(o)"
                  >
                    Nova senha
                  </button>
                </span>
              </li>
            }
          </ul>
        </div>
      }
    </div>
  `,
})
export class CrmCentralOperadoresComponent implements OnInit {
  private readonly api = inject(CentralOperadoresApi);
  private readonly toast = inject(ToastService);

  readonly carregando = signal(true);
  readonly erro = signal<string | null>(null);
  readonly operadores = signal<OperadorCentral[]>([]);
  readonly alterando = signal<number | null>(null);
  readonly novoNome = signal('');
  readonly novoEmail = signal('');
  readonly criando = signal(false);
  /** Senha temporária na tela (só até o admin fechar o aviso). */
  readonly senhaMostrada = signal<{ nome: string; senha: string } | null>(null);

  ngOnInit(): void {
    this.carregar();
  }

  carregar(): void {
    this.carregando.set(true);
    this.erro.set(null);
    this.api.listar().subscribe({
      next: (l) => {
        this.operadores.set(Array.isArray(l) ? l : []);
        this.carregando.set(false);
      },
      error: (e) => {
        this.erro.set(mensagem(e, 'Não foi possível carregar os operadores.'));
        this.carregando.set(false);
      },
    });
  }

  criar(): void {
    const nome = this.novoNome().trim();
    const email = this.novoEmail().trim();
    if (!nome || !email || this.criando()) return;
    this.criando.set(true);
    this.api.criar({ nome, email }).subscribe({
      next: (r) => {
        this.criando.set(false);
        this.novoNome.set('');
        this.novoEmail.set('');
        this.senhaMostrada.set({ nome, senha: r.senha_temporaria });
        this.toast.trigger(`Operador "${nome}" criado.`, 'success');
        this.carregar();
      },
      error: (e) => {
        this.criando.set(false);
        this.toast.trigger(mensagem(e, 'Não foi possível criar o operador.'), 'error');
      },
    });
  }

  /** Desativar derruba as sessões: pede confirmação. Reativar vai direto. */
  alternarAtivo(o: OperadorCentral, caixa: HTMLInputElement): void {
    const ligado = caixa.checked;
    if (!ligado && !confirm(`Desativar "${o.nome}"? As sessões abertas dele caem na hora.`)) {
      caixa.checked = o.ativo;
      return;
    }
    this.alterando.set(o.id);
    this.api.definirAtivo(o.id, ligado).subscribe({
      next: (r) => {
        const ativo = typeof r?.ativo === 'boolean' ? r.ativo : ligado;
        this.operadores.update((l) => l.map((x) => (x.id === o.id ? { ...x, ativo } : x)));
        caixa.checked = ativo;
        this.alterando.set(null);
        this.toast.trigger(ativo ? `"${o.nome}" reativado.` : `"${o.nome}" desativado.`, 'info');
      },
      error: (e) => {
        caixa.checked = o.ativo;
        this.alterando.set(null);
        this.toast.trigger(mensagem(e, 'Não foi possível alterar.'), 'error');
      },
    });
  }

  novaSenha(o: OperadorCentral): void {
    if (!confirm(`Gerar uma senha temporária nova para "${o.nome}"? A senha atual deixa de valer e as sessões caem.`)) return;
    this.alterando.set(o.id);
    this.api.novaSenha(o.id).subscribe({
      next: (r) => {
        this.alterando.set(null);
        this.senhaMostrada.set({ nome: o.nome, senha: r.senha_temporaria });
        this.operadores.update((l) => l.map((x) => (x.id === o.id ? { ...x, trocar_senha: true } : x)));
      },
      error: (e) => {
        this.alterando.set(null);
        this.toast.trigger(mensagem(e, 'Não foi possível gerar a senha.'), 'error');
      },
    });
  }

  copiar(): void {
    const s = this.senhaMostrada();
    if (!s) return;
    navigator.clipboard
      ?.writeText(s.senha)
      .then(() => this.toast.trigger('Senha copiada.', 'success'))
      .catch(() => this.toast.trigger('Não foi possível copiar.', 'error'));
  }
}
