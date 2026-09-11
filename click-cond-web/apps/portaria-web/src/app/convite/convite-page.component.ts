import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { API_BASE } from '../shared/api.config';
import { ThemeService } from '../shared/theme.service';

/**
 * Página que o VISITANTE abre pelo link do WhatsApp. Não exige conta.
 *
 * Segue o vocabulário visual do console — `app-bg`, `bg-graphite-*`,
 * `bg-accent` e a classe `light` no elemento raiz —, e não uma paleta
 * própria. A primeira versão desta tela cravou slate/emerald: não
 * acompanhava o tema claro/escuro (as regras de `.light` em styles.css
 * remapeiam justamente `bg-graphite-*` e `text-white`) e usava verde onde a
 * marca é azul. Para muitos visitantes esta é a ÚNICA tela do produto que
 * eles vão ver; ela é a cara do condomínio.
 *
 * Três decisões de conteúdo, herdadas do desenho:
 *
 *  1. Nada do morador aparece — só condomínio e unidade. Quem estiver com o
 *     link não descobre quem mora lá.
 *  2. O aceite é obrigatório e fica registrado com data: está sendo pedido
 *     CPF e foto de quem não é usuário do sistema.
 *  3. Link inválido, expirado e já usado mostram a MESMA mensagem — a tela
 *     não ajuda ninguém a descobrir quais links existem.
 */
@Component({
  selector: 'app-convite-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div
      class="min-h-screen app-bg font-sans transition-colors duration-500 px-4 py-8 sm:py-12"
      [ngClass]="isLight() ? 'light' : ''"
    >
      <div class="w-full max-w-md mx-auto space-y-6">

        <!-- Marca, no mesmo formato da tela de login -->
        <div class="flex items-center justify-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-accent/10 border border-accent/25 flex items-center justify-center">
            <svg class="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
          </div>
          <span class="text-lg font-bold tracking-tight uppercase text-white">
            Prestare <span class="text-accent font-extrabold">Click</span>
          </span>
        </div>

        @if (carregando()) {
          <div class="py-24 text-center">
            <div class="inline-block w-7 h-7 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
          </div>
        } @else if (indisponivel()) {
          <div class="rounded-2xl bg-graphite-200 border border-white/10 p-8 text-center space-y-3">
            <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
              <svg class="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <h1 class="text-lg font-bold text-white">Convite indisponível</h1>
            <p class="text-sm text-slate-400">
              Este convite já foi usado ou expirou. Peça um novo para quem te convidou.
            </p>
          </div>
        } @else if (enviado()) {
          <div class="rounded-2xl bg-graphite-200 border border-accent/20 p-8 text-center space-y-3">
            <div class="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center mx-auto">
              <svg class="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h1 class="text-lg font-bold text-white">Dados enviados</h1>
            <p class="text-sm text-slate-400">
              O morador foi avisado e vai confirmar sua entrada. Você já pode fechar esta página.
            </p>
          </div>
        } @else {

          <div class="text-center space-y-1.5">
            <span class="px-3 py-1 rounded-full bg-accent/10 border border-accent/25 text-[10px] text-accent font-semibold tracking-wider uppercase inline-block">
              {{ convite()?.is_prestador ? 'Cadastro de prestador' : 'Cadastro de visitante' }}
            </span>
            <h1 class="text-2xl font-extrabold tracking-tight text-white pt-1">{{ convite()?.condominio }}</h1>
            <p class="text-sm text-slate-400">{{ convite()?.unidade }}</p>
          </div>

          <form class="rounded-2xl bg-graphite-200 border border-white/10 p-5 sm:p-6 space-y-5" (ngSubmit)="enviar()">

            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nome completo</label>
              <input
                type="text" name="nome" [(ngModel)]="nome" autocomplete="name"
                class="w-full rounded-xl bg-graphite-100 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-accent/60 transition"
                placeholder="Como no seu documento" />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider">CPF</label>
              <input
                type="tel" name="cpf" [(ngModel)]="cpf" inputmode="numeric" maxlength="14"
                (ngModelChange)="aoDigitarCpf($event)"
                class="w-full rounded-xl bg-graphite-100 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-accent/60 transition"
                placeholder="000.000.000-00" />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Foto do rosto</label>
              @if (fotoPreview()) {
                <div class="relative">
                  <img [src]="fotoPreview()" alt="Sua foto" class="w-full h-56 object-cover rounded-xl border border-white/10" />
                  <button type="button" (click)="limparFoto()"
                    class="absolute top-2 right-2 px-3 py-1.5 rounded-lg bg-black/70 text-xs font-semibold keep-white border border-white/20 backdrop-blur-sm">
                    Trocar foto
                  </button>
                </div>
              } @else {
                <label class="flex flex-col items-center justify-center gap-2 h-40 rounded-xl border border-dashed border-accent/30 bg-accent/[0.04] cursor-pointer transition hover:bg-accent/[0.08]">
                  <div class="w-11 h-11 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center">
                    <svg class="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                  </div>
                  <span class="text-sm font-semibold text-accent">Tirar foto</span>
                  <span class="text-[11px] text-slate-500">O porteiro usa para te reconhecer na chegada</span>
                  <!-- capture="user" abre a câmera frontal direto no celular. -->
                  <input type="file" accept="image/*" capture="user" class="hidden" (change)="selecionarFoto($event)" />
                </label>
              }
            </div>

            <!--
              Aviso + aceite. Sem isso, o que acontece aqui é coleta de CPF e
              foto de uma pessoa que não é usuária do sistema, sem dizer para
              quê nem por quanto tempo.
            -->
            <label class="flex items-start gap-3 p-3 rounded-xl bg-graphite-100 border border-white/10 cursor-pointer">
              <input type="checkbox" name="aceite" [(ngModel)]="aceite"
                class="mt-0.5 rounded border-white/20 bg-transparent text-accent focus:ring-0 w-4 h-4 shrink-0" />
              <span class="text-[11px] leading-relaxed text-slate-400">
                Autorizo o condomínio a usar meu nome, CPF e foto para autorizar
                minha entrada. Os dados ficam com o condomínio e são apagados se
                a visita não for confirmada.
                <a routerLink="/politica-de-privacidade" target="_blank" class="text-accent font-semibold hover:underline">Política de privacidade</a>.
              </span>
            </label>

            @if (erro()) {
              <p class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">{{ erro() }}</p>
            }

            <button type="submit" [disabled]="enviando()"
              class="w-full rounded-xl bg-accent font-bold text-sm py-3.5 keep-white shadow-lg shadow-accent/20 transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none">
              {{ enviando() ? 'Enviando...' : 'Enviar meus dados' }}
            </button>
          </form>

          <p class="text-center text-[11px] text-slate-500">
            Seus dados vão apenas para o condomínio acima.
          </p>
        }
      </div>
    </div>
  `,
})
export class ConvitePageComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private theme = inject(ThemeService);

  readonly isLight = this.theme.isLight;

  readonly carregando = signal(true);
  readonly indisponivel = signal(false);
  readonly enviado = signal(false);
  readonly enviando = signal(false);
  readonly erro = signal<string | null>(null);
  readonly convite = signal<{ condominio: string; unidade: string; is_prestador: boolean } | null>(null);
  readonly fotoPreview = signal<string | null>(null);

  nome = '';
  cpf = '';
  aceite = false;

  private token = '';

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';

    // Link sem token (cortado ao copiar do WhatsApp, por exemplo) é um
    // convite inválido como qualquer outro. Mostra a mesma tela em vez de
    // gastar uma chamada — e, principalmente, em vez de ficar em branco.
    if (!this.token.trim()) {
      this.indisponivel.set(true);
      this.carregando.set(false);
      return;
    }

    this.http.get<any>(`${API_BASE}/convites/publico/${this.token}`).subscribe({
      next: (dados) => {
        this.convite.set(dados);
        this.carregando.set(false);
      },
      // Inválido, expirado e usado caem todos aqui, com a mesma tela: o
      // servidor já devolve a mesma resposta para os três.
      error: () => {
        this.indisponivel.set(true);
        this.carregando.set(false);
      },
    });
  }

  /** Máscara enquanto digita. Quem envia o CPF aqui costuma estar no celular. */
  aoDigitarCpf(valor: string) {
    const d = (valor ?? '').replace(/\D/g, '').slice(0, 11);
    this.cpf = d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }

  selecionarFoto(evento: Event) {
    const arquivo = (evento.target as HTMLInputElement).files?.[0];
    if (!arquivo) return;
    if (arquivo.size > 5 * 1024 * 1024) {
      this.erro.set('Foto maior que 5MB. Tente outra.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => this.erro.set('Não consegui ler a foto.');
    reader.onload = () => {
      this.fotoPreview.set(String(reader.result ?? ''));
      this.erro.set(null);
    };
    reader.readAsDataURL(arquivo);
  }

  limparFoto() {
    this.fotoPreview.set(null);
  }

  enviar() {
    // Validação local só para dar resposta imediata; quem decide é o servidor,
    // que revalida tudo — inclusive o dígito verificador do CPF.
    if (this.nome.trim().length < 3) return this.erro.set('Informe seu nome completo.');
    if (!this.fotoPreview()) return this.erro.set('Envie uma foto do seu rosto.');
    if (!this.aceite) return this.erro.set('É preciso aceitar o uso dos dados para continuar.');

    this.enviando.set(true);
    this.erro.set(null);
    this.http
      .post(`${API_BASE}/convites/publico/${this.token}`, {
        nome: this.nome.trim(),
        cpf: this.cpf,
        foto: this.fotoPreview(),
        aceite: true,
      })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.enviado.set(true);
        },
        error: (e) => {
          this.enviando.set(false);
          this.erro.set(e?.error?.message ?? 'Não consegui enviar. Tente de novo.');
        },
      });
  }
}
