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
 * `bg-accent` e `ps-*` do tema Prestare Dark —, e não uma paleta
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
    >
      <div class="w-full max-w-md mx-auto space-y-6">

        <!-- Marca, no mesmo formato da tela de login -->
        <div class="ps-brand justify-center">
          <img [src]="isLight() ? '/prestare-marca-preta.svg' : '/prestare-marca-branca.svg'" alt="Prestare Gestão" />
          <div>
            <div class="ps-brand-wm">PRESTARE <span>GESTÃO</span></div>
            <div class="ps-label mt-1" style="font-size: 9px; line-height: 10px;">Web Console</div>
          </div>
        </div>

        @if (carregando()) {
          <div class="py-24 text-center">
            <div class="inline-block w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          </div>
        } @else if (indisponivel()) {
          <div class="ps-panel p-8 text-center space-y-3">
            <div class="w-14 h-14 border flex items-center justify-center mx-auto" style="border-color: var(--line-200)">
              <svg class="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <h1 class="ps-h1">Convite indisponível</h1>
            <p class="text-sm text-slate-400">
              Este convite já foi usado ou expirou. Peça um novo para quem te convidou.
            </p>
          </div>
        } @else if (enviado()) {
          <div class="ps-panel p-8 text-center space-y-3">
            <div class="w-14 h-14 border flex items-center justify-center mx-auto" style="border-color: var(--line-200)">
              <svg class="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h1 class="ps-h1">Dados enviados</h1>
            <p class="text-sm text-slate-400">
              O morador foi avisado e vai confirmar sua entrada. Você já pode fechar esta página.
            </p>
          </div>
        } @else {

          <div class="text-center space-y-1.5">
            <span class="ps-tag">
              {{ convite()?.is_prestador ? 'Cadastro de prestador' : 'Cadastro de visitante' }}
            </span>
            <h1 class="ps-h1 pt-2">{{ convite()?.condominio }}</h1>
            <p class="text-sm text-slate-400">{{ convite()?.unidade }}</p>
          </div>

          <form class="ps-panel p-5 sm:p-6 space-y-5" (ngSubmit)="enviar()">

            <div class="space-y-1.5">
              <label class="ps-label block">Nome completo</label>
              <input
                type="text" name="nome" [(ngModel)]="nome" autocomplete="name"
                class="w-full h-10 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none transition" style="background: var(--bg-300); border: 1px solid var(--line-200)"
                placeholder="Como no seu documento" />
            </div>

            <div class="space-y-1.5">
              <label class="ps-label block">CPF</label>
              <input
                type="tel" name="cpf" [(ngModel)]="cpf" inputmode="numeric" maxlength="14"
                (ngModelChange)="aoDigitarCpf($event)"
                class="w-full h-10 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none transition" style="background: var(--bg-300); border: 1px solid var(--line-200)"
                placeholder="000.000.000-00" />
            </div>

            <div class="space-y-1.5">
              <label class="ps-label block">Foto do rosto</label>
              @if (fotoPreview()) {
                <div class="relative">
                  <img [src]="fotoPreview()" alt="Sua foto" class="w-full h-56 object-cover border border-white/10" />
                  <button type="button" (click)="limparFoto()"
                    class="ps-btn ps-btn-sm absolute top-2 right-2">
                    Trocar foto
                  </button>
                </div>
              } @else {
                <label class="flex flex-col items-center justify-center gap-2 h-40 border border-dashed border-white/30 cursor-pointer transition hover:bg-white/5">
                  <div class="w-11 h-11 border flex items-center justify-center" style="border-color: var(--line-200)">
                    <svg class="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                  </div>
                  <span class="text-sm font-semibold text-white">Tirar foto</span>
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
            <label class="flex items-start gap-3 p-3 border border-white/10 cursor-pointer">
              <input type="checkbox" name="aceite" [(ngModel)]="aceite"
                class="mt-0.5 w-4 h-4 shrink-0" style="accent-color: var(--accent)" />
              <span class="text-[11px] leading-relaxed text-slate-400">
                Autorizo o condomínio a usar meu nome, CPF e foto para autorizar
                minha entrada, <strong class="text-slate-300">inclusive pelo reconhecimento facial da portaria</strong>,
                e declaro ter 18 anos ou mais. Os dados ficam com o condomínio e
                são apagados se a visita não for confirmada.
                <a routerLink="/politica-de-privacidade" target="_blank" class="text-white underline font-semibold">Política de privacidade</a>.
              </span>
            </label>

            @if (erro()) {
              <p class="text-xs text-red-400 border px-3 py-2.5" style="border-color: var(--line-200)" role="alert">{{ erro() }}</p>
            }

            <button type="submit" [disabled]="enviando()"
              class="ps-btn ps-btn-lg w-full disabled:opacity-40 disabled:pointer-events-none">
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
    this.token =
      this.route.snapshot.paramMap.get('token') ??
      this.route.snapshot.queryParamMap.get('convite') ??
      '';

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

  /**
   * Lê a foto e REDIMENSIONA antes de enviar.
   *
   * Sem isso, o teto de 5 MB do cliente (bytes do arquivo) e o do servidor
   * (bytes do base64, ~33% maiores) discordam: uma foto de 4,5 MB — comum em
   * celular recente — passava aqui e era recusada lá, sem a página oferecer
   * nenhuma saída. O visitante ficava travado no meio do cadastro.
   *
   * Reduzir também é o certo pelo uso: a foto serve ao porteiro conferir um
   * rosto na tela, não a impressão. 1280px de lado maior sobra.
   */
  selecionarFoto(evento: Event) {
    const arquivo = (evento.target as HTMLInputElement).files?.[0];
    if (!arquivo) return;
    if (!arquivo.type.startsWith('image/')) {
      this.erro.set('Escolha uma imagem.');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => this.erro.set('Não consegui ler a foto.');
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => this.erro.set('Não consegui abrir essa imagem.');
      img.onload = () => {
        const LADO_MAX = 1280;
        const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          this.erro.set('Não consegui preparar a foto neste navegador.');
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // JPEG sempre: o servidor só aceita jpeg/png/webp, e converter aqui
        // elimina HEIC do iPhone e qualquer formato exótico da galeria.
        this.fotoPreview.set(canvas.toDataURL('image/jpeg', 0.85));
        this.erro.set(null);
      };
      img.src = String(reader.result ?? '');
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
        // O texto do aceite cita o reconhecimento facial e a maioridade: vale
        // como consentimento de biometria (LGPD Art. 11) e libera o rosto no
        // terminal quando o morador confirmar.
        aceite_biometria: true,
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
