import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../auth/auth.service';
import { papelDoToken } from '../../auth/papel';
import { DeliveryApi } from '../delivery.service';

/**
 * Painel "Autoatendimento no portão": liga/desliga por condomínio e horário
 * de funcionamento (os dois vazios = dia inteiro). Mexe em acesso físico,
 * então só o síndico vê — o mesmo critério da API (assertSindicoEstrito,
 * pelo typeAccess do token, não pelo turno texto livre do porteiro).
 *
 * O QR de cada portão é gerado em Configurações → Terminais de Dispositivos; aqui só a opção do condomínio.
 */
@Component({
  selector: 'app-delivery-autoatendimento',
  standalone: true,
  host: { class: 'block' },
  imports: [FormsModule],
  template: `
    @if (souSindico) {
      <section class="ps-panel space-y-4 p-4" aria-labelledby="titulo-autoatendimento">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 id="titulo-autoatendimento" class="ps-h2">Autoatendimento no portão</h2>
            <p class="mt-1 text-sm text-slate-400">
              O entregador lê o QR no portão, tira uma foto e o morador decide. Gere o QR de cada portão em Configurações → Terminais de Dispositivos.
            </p>
          </div>
          @if (carregado()) {
            <label class="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" name="habilitado" class="h-4 w-4" style="accent-color: var(--brand)"
                [ngModel]="habilitado()" (ngModelChange)="habilitado.set($event)" />
              {{ habilitado() ? 'Ligado' : 'Desligado' }}
            </label>
          }
        </div>

        @if (carregado()) {
          <div class="flex flex-wrap items-end gap-3">
            <label class="block">
              <span class="ps-label mb-1.5 block">Início</span>
              <input type="time" name="inicio" class="h-10 w-36 px-3 text-sm bg-graphite-50 border border-slate-300 text-white focus:outline-none focus:border-[var(--ink)]"
                [ngModel]="inicio()" (ngModelChange)="inicio.set($event ?? '')" />
            </label>
            <label class="block">
              <span class="ps-label mb-1.5 block">Fim</span>
              <input type="time" name="fim" class="h-10 w-36 px-3 text-sm bg-graphite-50 border border-slate-300 text-white focus:outline-none focus:border-[var(--ink)]"
                [ngModel]="fim()" (ngModelChange)="fim.set($event ?? '')" />
            </label>
            <button type="button" (click)="salvar()" [disabled]="salvando()" class="ps-btn disabled:opacity-40">Salvar</button>
            <p class="text-xs text-slate-500">Sem horário, vale o dia inteiro.</p>
          </div>
        }

        @if (erro()) {
          <p role="alert" class="text-sm text-red-700 dark:text-red-300">{{ erro() }}</p>
        }
        @if (salvo()) {
          <p role="status" class="text-sm text-slate-300">Salvo.</p>
        }
      </section>
    }
  `,
})
export class DeliveryAutoatendimentoComponent implements OnInit {
  private readonly api = inject(DeliveryApi);
  private readonly auth = inject(AuthService);

  readonly souSindico = papelDoToken(this.auth.token) === 'sindico';

  readonly carregado = signal(false);
  readonly habilitado = signal(false);
  readonly inicio = signal('');
  readonly fim = signal('');
  readonly salvando = signal(false);
  readonly salvo = signal(false);
  readonly erro = signal<string | null>(null);

  ngOnInit(): void {
    if (!this.souSindico) return;
    this.api.lerConfigEntrega().subscribe({
      next: (c) => {
        this.aplicar(c);
        this.carregado.set(true);
      },
      error: () => this.erro.set('Não foi possível carregar o autoatendimento de entregas.'),
    });
  }

  salvar(): void {
    if (this.salvando()) return;
    this.salvando.set(true);
    this.salvo.set(false);
    this.erro.set(null);
    this.api
      .salvarConfigEntrega({
        habilitado: this.habilitado(),
        inicio: this.inicio().trim() || null,
        fim: this.fim().trim() || null,
      })
      .subscribe({
        next: (c) => {
          this.salvando.set(false);
          this.aplicar(c);
          this.salvo.set(true);
        },
        error: (e) => {
          this.salvando.set(false);
          // "Horário inválido. Use HH:MM." (só início, só fim) vem pronto da API.
          this.erro.set(e?.error?.message ?? 'Não foi possível salvar o autoatendimento de entregas.');
        },
      });
  }

  private aplicar(c: { habilitado: boolean; inicio: string | null; fim: string | null }) {
    this.habilitado.set(!!c?.habilitado);
    this.inicio.set(c?.inicio ?? '');
    this.fim.set(c?.fim ?? '');
  }
}
