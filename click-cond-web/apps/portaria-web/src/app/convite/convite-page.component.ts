import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { API_BASE } from '../shared/api.config';

/**
 * Página que o VISITANTE abre pelo link do WhatsApp. Não exige conta.
 *
 * É a primeira tela pública do produto em que alguém de fora grava dado, e
 * isso molda três escolhas visíveis aqui:
 *
 *  1. Nada de dado do morador na tela — só condomínio e unidade. Quem estiver
 *     com o link não descobre quem mora lá.
 *  2. O aceite é obrigatório e fica registrado com data. Está sendo pedido CPF
 *     e foto de quem não é usuário do sistema.
 *  3. Link inválido, expirado e já usado mostram a MESMA mensagem — a tela não
 *     ajuda ninguém a descobrir quais links existem.
 */
@Component({
  selector: 'app-convite-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="min-h-screen bg-slate-950 text-slate-200 px-4 py-8 flex justify-center">
      <div class="w-full max-w-md space-y-6">

        @if (carregando()) {
          <div class="py-24 text-center">
            <div class="inline-block w-7 h-7 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin"></div>
          </div>
        } @else if (indisponivel()) {
          <div class="rounded-2xl bg-slate-900 border border-white/10 p-8 text-center space-y-3">
            <div class="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
              <svg class="w-7 h-7 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <h1 class="text-lg font-bold text-white">Convite indisponível</h1>
            <p class="text-sm text-slate-400">
              Este convite já foi usado ou expirou. Peça um novo para quem te convidou.
            </p>
          </div>
        } @else if (enviado()) {
          <div class="rounded-2xl bg-slate-900 border border-emerald-500/20 p-8 text-center space-y-3">
            <div class="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <svg class="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <h1 class="text-lg font-bold text-white">Dados enviados</h1>
            <p class="text-sm text-slate-400">
              O morador foi avisado e vai confirmar sua entrada. Você já pode fechar esta página.
            </p>
          </div>
        } @else {

          <div class="text-center space-y-2">
            <p class="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
              {{ convite()?.is_prestador ? 'Cadastro de prestador' : 'Cadastro de visitante' }}
            </p>
            <h1 class="text-xl font-bold text-white">{{ convite()?.condominio }}</h1>
            <p class="text-sm text-slate-400">{{ convite()?.unidade }}</p>
          </div>

          <form class="rounded-2xl bg-slate-900 border border-white/10 p-5 space-y-4" (ngSubmit)="enviar()">

            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-400">Nome completo</label>
              <input
                type="text" name="nome" [(ngModel)]="nome" autocomplete="name"
                class="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                placeholder="Como no seu documento" />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-400">CPF</label>
              <input
                type="tel" name="cpf" [(ngModel)]="cpf" inputmode="numeric"
                class="w-full rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                placeholder="000.000.000-00" />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-slate-400">Foto do rosto</label>
              @if (fotoPreview()) {
                <div class="relative">
                  <img [src]="fotoPreview()" alt="Sua foto" class="w-full h-48 object-cover rounded-xl border border-white/10" />
                  <button type="button" (click)="limparFoto()"
                    class="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-slate-950/80 text-xs text-white border border-white/10">
                    Trocar
                  </button>
                </div>
              } @else {
                <label class="flex flex-col items-center justify-center gap-2 h-32 rounded-xl border border-dashed border-white/15 bg-slate-950 cursor-pointer">
                  <svg class="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                  <span class="text-xs text-slate-400">Tirar foto ou escolher</span>
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
            <label class="flex items-start gap-2.5 pt-1 cursor-pointer">
              <input type="checkbox" name="aceite" [(ngModel)]="aceite"
                class="mt-0.5 rounded border-white/20 bg-slate-950 text-emerald-500 focus:ring-0 w-4 h-4 shrink-0" />
              <span class="text-[11px] leading-snug text-slate-400">
                Autorizo o condomínio a usar meu nome, CPF e foto para autorizar
                minha entrada. Os dados ficam com o condomínio e são apagados se
                a visita não for confirmada.
                <a routerLink="/politica-de-privacidade" target="_blank" class="text-emerald-400 underline">Política de privacidade</a>.
              </span>
            </label>

            @if (erro()) {
              <p class="text-xs text-red-300 bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">{{ erro() }}</p>
            }

            <button type="submit" [disabled]="enviando()"
              class="w-full rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm py-3 disabled:opacity-40 disabled:pointer-events-none">
              {{ enviando() ? 'Enviando...' : 'Enviar meus dados' }}
            </button>
          </form>
        }
      </div>
    </div>
  `,
})
export class ConvitePageComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

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
