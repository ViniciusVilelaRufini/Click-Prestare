import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ThemeService } from '../shared/theme.service';
import { CentralAlertasComponent } from './central-alertas.component';
import { CentralAtendimentoComponent } from './central-atendimento.component';
import { CentralAuthService } from './central-auth.service';
import { CentralFilaComponent } from './central-fila.component';
import { CentralHistoricoComponent } from './central-historico.component';
import { CentralLigarComponent } from './central-ligar.component';
import { CentralTrocarSenhaComponent } from './central-trocar-senha.component';
import { CentralStore } from './central.store';

export type AbaCentral = 'atendimento' | 'historico' | 'ligar';

/**
 * `/central`: a tela que os operadores da Prestare usam o dia todo. Esquerda: fila de chamadas e alertas de todos
 * os condomínios. Centro/direita: a chamada em atendimento e o contexto. Abas Histórico e Ligar.
 * Com senha temporária, só a troca de senha (nada da central funciona antes).
 */
@Component({
  selector: 'app-central-page',
  standalone: true,
  imports: [
    CentralFilaComponent,
    CentralAlertasComponent,
    CentralAtendimentoComponent,
    CentralHistoricoComponent,
    CentralLigarComponent,
    CentralTrocarSenhaComponent,
  ],
  template: `
    <div class="min-h-screen app-bg font-sans text-[var(--ink)]">
      <header class="sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 min-[900px]:px-6 py-3 border-b border-[var(--line-100)] bg-[var(--bg-100)]">
        <div class="ps-brand">
          <img [src]="tema.isLight() ? '/prestare-marca-preta.svg' : '/prestare-marca-branca.svg'" alt="Prestare" />
          <div>
            <div class="ps-brand-wm">PRESTARE <span>CENTRAL</span></div>
            <div class="ps-label mt-1" style="font-size: 9px; line-height: 10px;">Portaria remota</div>
          </div>
        </div>

        @if (!trocarSenha()) {
          <nav class="ps-seg ml-0 min-[900px]:ml-4" aria-label="Seções da Central">
            @for (a of abas; track a.id) {
              <button type="button" [class.on]="aba() === a.id" [attr.aria-current]="aba() === a.id ? 'page' : null"
                [style.background]="aba() === a.id ? 'var(--brand)' : null" (click)="aba.set(a.id)">{{ a.rotulo }}</button>
            }
          </nav>
        }

        <div class="ml-auto flex items-center gap-3">
          @if (!trocarSenha()) {
            <span class="flex items-center gap-2 ps-cap" data-teste="conexao">
              <span class="ps-dot" [class.ps-dot-ok]="store.conectado()" [class.ps-dot-danger]="!store.conectado()"></span>
              {{ store.conectado() ? 'Conectado' : store.reconectando() ? 'Reconectando…' : 'Sem conexão' }}
            </span>
          }
          <span class="ps-cap hidden min-[640px]:inline">{{ auth.operador()?.nome }}</span>
          <button type="button" class="ps-btn ps-btn-ghost ps-btn-sm" (click)="sair()">Sair</button>
        </div>
      </header>

      @if (trocarSenha()) {
        <main class="px-4 py-10">
          <app-central-trocar-senha (trocada)="aoTrocarSenha()" />
        </main>
      } @else {
        <div class="px-4 min-[900px]:px-6 pt-4 space-y-2" aria-live="polite">
          @if (avisoConexao(); as motivo) {
            <div role="alert" class="ps-panel flex items-start gap-2.5 px-4 py-3">
              <span class="ps-dot ps-dot-danger mt-1.5"></span>
              <p class="text-sm text-[var(--ink-muted)]">{{ motivo }}</p>
            </div>
          }
          @if (store.somBloqueado()) {
            <button type="button" class="ps-panel flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm" (click)="store.ativarSom()">
              <span class="ps-dot ps-dot-warn ps-dot-pulse"></span>Clique para ativar o som da Central (chamadas e alarme de pânico)
            </button>
          }
          @if (store.aviso() || store.erro()) {
            <div role="status" class="ps-panel flex items-start gap-2.5 px-4 py-3">
              <span class="ps-dot mt-1.5" [class.ps-dot-danger]="!!store.erro() && !store.aviso()" [class.ps-dot-ink]="!!store.aviso()"></span>
              <p class="text-sm flex-1">{{ store.aviso() ?? store.erro() }}</p>
              <button type="button" class="ps-ibtn -mr-2 -mt-1" aria-label="Fechar aviso" (click)="store.fecharAviso()">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          }
        </div>

        <main class="grid gap-4 px-4 min-[900px]:px-6 py-4 min-[900px]:grid-cols-[340px_minmax(0,1fr)] items-start">
          <div class="space-y-4">
            <app-central-alertas />
            <app-central-fila />
          </div>
          <div class="min-w-0">
            <app-central-atendimento [class.hidden]="aba() !== 'atendimento'" />
            @if (aba() === 'historico') {
              <app-central-historico />
            }
            @if (aba() === 'ligar') {
              <app-central-ligar />
            }
          </div>
        </main>
      }
    </div>
  `,
})
export class CentralPageComponent implements OnDestroy {
  readonly store = inject(CentralStore);
  readonly auth = inject(CentralAuthService);
  readonly tema = inject(ThemeService);
  private readonly router = inject(Router);

  readonly abas: readonly { id: AbaCentral; rotulo: string }[] = [
    { id: 'atendimento', rotulo: 'Atendimento' },
    { id: 'historico', rotulo: 'Histórico' },
    { id: 'ligar', rotulo: 'Ligar' },
  ];
  readonly aba = signal<AbaCentral>('atendimento');
  readonly trocarSenha = computed(() => !!this.auth.operador()?.trocar_senha);

  /** Por que este console não vai tocar agora (null = tudo certo). Depois de 5 s, para não piscar ao abrir. */
  private readonly carencia = signal(true);
  private timerCarencia: ReturnType<typeof setTimeout> | null = setTimeout(() => this.carencia.set(false), 5_000);
  readonly avisoConexao = computed<string | null>(() => {
    if (this.store.microfoneNegado()) {
      return 'O navegador bloqueou o microfone. Você não vai conseguir atender até liberar o microfone para este site.';
    }
    // Queda causada pelo servidor: aparece já (não é o piscar da abertura) e diz que há nova tentativa.
    if (this.store.reconectando()) {
      return 'Sem conexão com a Central. Tentando reconectar… Você não vai receber chamadas nem alertas até a conexão voltar.';
    }
    if (!this.store.conectado() && !this.carencia()) {
      return 'Sem conexão com a Central. Você não vai receber chamadas nem alertas até a conexão voltar.';
    }
    return null;
  });

  constructor() {
    // Sessão: sem operador → login; senha temporária → só a troca; senão a central funciona.
    effect(() => {
      const op = this.auth.operador();
      untracked(() => {
        if (!op) {
          this.store.parar();
          void this.router.navigateByUrl('/central/login');
        } else if (op.trocar_senha) {
          this.store.parar();
        } else {
          this.store.iniciar();
        }
      });
    });
    // Atendeu ou ligou: mostra a chamada.
    effect(() => {
      if (this.store.emChamada()) untracked(() => this.aba.set('atendimento'));
    });
  }

  aoTrocarSenha(): void {
    // O token novo já está gravado e o socket reconectou (tokenRenovado$); o efeito da sessão liga a central.
    this.aba.set('atendimento');
  }

  sair(): void {
    this.store.parar();
    this.auth.logout();
  }

  ngOnDestroy(): void {
    if (this.timerCarencia) clearTimeout(this.timerCarencia);
    this.timerCarencia = null;
    this.store.parar();
  }
}
