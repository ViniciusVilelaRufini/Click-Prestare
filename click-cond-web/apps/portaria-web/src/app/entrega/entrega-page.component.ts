import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Subscription, timeout } from 'rxjs';
import { API_BASE } from '../shared/api.config';
import { ThemeService } from '../shared/theme.service';

/** Resposta de `GET /entrega/publico/:token`. Só números de unidade: nenhum nome. */
export interface PortaoPublico {
  condominio: string;
  portao: string;
  disponivel: boolean;
  motivo?: 'desligado' | 'fora_horario';
  horario?: { inicio: string; fim: string };
  unidades: { id: number; bloco: string | null; apto: string | null }[];
}

export type SituacaoEntrega =
  | 'aguardando'
  | 'sem_resposta'
  | 'liberado'
  | 'liberado_portaria'
  | 'aberto'
  | 'vou_buscar'
  | 'recusado'
  | 'expirado';

export interface EstadoEntrega {
  situacao: SituacaoEntrega;
  pode_abrir: boolean;
  pode_sair: boolean;
  liberado_ate: string | null;
  /** Só na consulta: a abertura decidida pela nuvem falhou. */
  falha_abertura?: boolean;
  /** Só em abrir/sair. */
  abriu?: boolean;
}

/** Consulta enquanto a situação não é final. */
const CONSULTA_MS = 3_000;
/** Depois de uma falha de rede, tenta de novo neste intervalo. */
const NOVA_TENTATIVA_MS = 5_000;
/** Consulta que não responde vira falha de rede. */
const TEMPO_LIMITE_MS = 10_000;
/**
 * Teto do acompanhamento: a saída vale até 30 min após a entrada; passado
 * isso nada mais muda para o entregador (e "liberado pela portaria" não tem
 * fim pela página). Evita uma aba esquecida consultando para sempre.
 */
const LIMITE_ACOMPANHAMENTO_MS = 40 * 60_000;
/** Lado maior da selfie enviada. */
const LADO_MAX_FOTO = 800;
const QUALIDADE_FOTO = 0.8;

const FINAIS: SituacaoEntrega[] = ['vou_buscar', 'recusado', 'expirado'];

export const PLATAFORMAS = ['iFood', 'Mercado Livre', 'Outra'];

/** Redução da selfie: lado maior até 800 px, proporção mantida; nunca aumenta. */
export function dimensoesReduzidas(largura: number, altura: number, ladoMax = LADO_MAX_FOTO) {
  const escala = Math.min(1, ladoMax / Math.max(largura, altura));
  return { largura: Math.round(largura * escala), altura: Math.round(altura * escala) };
}

function situacaoFinal(e: EstadoEntrega): boolean {
  return FINAIS.includes(e.situacao) || (e.situacao === 'aberto' && !e.pode_sair);
}

/**
 * Página que o ENTREGADOR abre ao ler o QR colado no portão. Não exige conta.
 *
 * Escolhe a unidade (bloco e apartamento, só números — a API nunca manda
 * nome de morador), informa o nome e a plataforma, tira uma selfie pela
 * câmera frontal e pede a entrada. Depois acompanha a resposta do morador a
 * cada 3 s: a consulta é também a "presença" — com a página aberta, a nuvem
 * abre o portão assim que o morador libera; sem ela, aparece "Abrir portão".
 *
 * O token do pedido (que só esta página conhece) vai sempre no corpo do POST
 * e fica guardado nesta aba (sessionStorage), para a aba recarregada retomar o
 * mesmo pedido em vez de pedir de novo.
 *
 * Visual: o vocabulário Prestare Dark do convite e do passe (`app-bg`, `ps-*`).
 */
@Component({
  selector: 'app-entrega-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="min-h-screen app-bg font-sans transition-colors duration-500 px-4 py-8 sm:py-12">
      <div class="w-full max-w-md mx-auto space-y-6">

        <!-- Marca, no mesmo formato do convite e do passe -->
        <div class="ps-brand justify-center">
          <img [src]="isLight() ? '/prestare-marca-preta.svg' : '/prestare-marca-branca.svg'" alt="Prestare Gestão" />
          <div>
            <div class="ps-brand-wm">PRESTARE <span>GESTÃO</span></div>
            <div class="ps-label mt-1" style="font-size: 9px; line-height: 10px;">Entregas</div>
          </div>
        </div>

        @switch (fase()) {
          @case ('carregando') {
            <div class="py-24 text-center">
              <div class="inline-block w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            </div>
          }

          @case ('indisponivel') {
            <div class="ps-panel p-8 text-center space-y-3">
              <div class="w-14 h-14 border flex items-center justify-center mx-auto" style="border-color: var(--line-200)">
                <svg class="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                </svg>
              </div>
              <h1 class="ps-h1">QR indisponível</h1>
              <p class="text-sm text-slate-400">Este QR não vale mais. Procure a portaria.</p>
            </div>
          }

          @case ('sem_rede') {
            <div class="ps-panel p-8 text-center space-y-4">
              <p class="text-sm text-amber-300" role="status">Não consegui carregar. Confira a internet do celular.</p>
              <button type="button" (click)="carregarPortao()" class="ps-btn ps-btn-lg w-full">Tentar de novo</button>
            </div>
          }

          @case ('fora') {
            <div class="text-center space-y-1.5">
              <span class="ps-tag">Entregas</span>
              <h1 class="ps-h1 pt-2">{{ portao()?.condominio }}</h1>
              <p class="text-sm text-slate-400">{{ portao()?.portao }}</p>
            </div>
            <div class="ps-panel p-8 text-center space-y-3">
              @if (portao()?.motivo === 'fora_horario' && portao()?.horario; as h) {
                <p class="text-sm text-slate-300">O autoatendimento de entregas funciona das {{ h.inicio }} às {{ h.fim }}.</p>
                <p class="text-[11px] text-slate-500">Fora desse horário, procure a portaria ou use o interfone.</p>
              } @else {
                <p class="text-sm text-slate-300">O autoatendimento de entregas está desligado. Procure a portaria.</p>
              }
            </div>
          }

          @case ('formulario') {
            <div class="text-center space-y-1.5">
              <span class="ps-tag">Entregas</span>
              <h1 class="ps-h1 pt-2">{{ portao()?.condominio }}</h1>
              <p class="text-sm text-slate-400">{{ portao()?.portao }}</p>
            </div>

            <form class="ps-panel p-5 sm:p-6 space-y-5" (ngSubmit)="enviar()">
              <div class="space-y-1.5">
                <label class="ps-label block">Unidade</label>
                <div class="grid gap-3" [class.grid-cols-2]="temBlocos()">
                  @if (temBlocos()) {
                    <select
                      name="bloco" [ngModel]="bloco()" (ngModelChange)="escolherBloco($event)"
                      class="w-full h-10 px-3 text-sm text-white focus:outline-none transition"
                      style="background: var(--bg-300); border: 1px solid var(--line-200)">
                      <option [ngValue]="null">Bloco</option>
                      @for (b of blocos(); track b) {
                        <option [ngValue]="b">{{ b || 'Sem bloco' }}</option>
                      }
                    </select>
                  }
                  <select
                    name="apto" [ngModel]="idApartamento()" (ngModelChange)="idApartamento.set($event)"
                    [disabled]="temBlocos() && bloco() === null"
                    class="w-full h-10 px-3 text-sm text-white focus:outline-none transition disabled:opacity-40"
                    style="background: var(--bg-300); border: 1px solid var(--line-200)">
                    <option [ngValue]="null">Apartamento</option>
                    @for (u of aptosDoBloco(); track u.id) {
                      <option [ngValue]="u.id">{{ u.apto }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="space-y-1.5">
                <label class="ps-label block">Seu nome</label>
                <input
                  type="text" name="nome" [ngModel]="nome()" (ngModelChange)="nome.set($event)" autocomplete="name" maxlength="80"
                  class="w-full h-10 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none transition"
                  style="background: var(--bg-300); border: 1px solid var(--line-200)"
                  placeholder="Como o morador vai te reconhecer" />
              </div>

              <div class="space-y-1.5">
                <label class="ps-label block">Plataforma</label>
                <select
                  name="plataforma" [ngModel]="plataforma()" (ngModelChange)="plataforma.set($event)"
                  class="w-full h-10 px-3 text-sm text-white focus:outline-none transition"
                  style="background: var(--bg-300); border: 1px solid var(--line-200)">
                  <option [ngValue]="null">Selecione</option>
                  @for (p of plataformas; track p) {
                    <option [ngValue]="p">{{ p }}</option>
                  }
                </select>
              </div>

              <div class="space-y-1.5">
                <label class="ps-label block">Foto do rosto</label>
                @if (foto()) {
                  <div class="relative">
                    <img [src]="foto()" alt="Sua foto" class="w-full h-56 object-cover border border-white/10" />
                    <button type="button" (click)="foto.set(null)" class="ps-btn ps-btn-sm absolute top-2 right-2">Trocar foto</button>
                  </div>
                } @else {
                  <label data-tirar-foto class="flex flex-col items-center justify-center gap-2 h-40 border border-dashed border-white/30 cursor-pointer transition hover:bg-white/5">
                    <div class="w-11 h-11 border flex items-center justify-center" style="border-color: var(--line-200)">
                      <svg class="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
                      </svg>
                    </div>
                    <span class="text-sm font-semibold text-white">Tirar foto</span>
                    <!-- capture="user" abre a câmera frontal direto no celular. -->
                    <input type="file" accept="image/*" capture="user" class="hidden" (change)="selecionarFoto($event)" />
                  </label>
                }
                <p class="text-[11px] leading-relaxed text-slate-400">
                  Sua foto será mostrada ao morador e guardada pelo condomínio por 90 dias.
                </p>
              </div>

              @if (erro()) {
                <p class="text-xs text-red-400 border px-3 py-2.5" style="border-color: var(--line-200)" role="alert">{{ erro() }}</p>
              }

              <button type="submit" [disabled]="!podeEnviar()"
                class="ps-btn ps-btn-lg w-full disabled:opacity-40 disabled:pointer-events-none">{{ enviando() ? 'Enviando...' : 'Pedir entrada' }}</button>
            </form>
          }

          @case ('acompanhando') {
            <div class="text-center space-y-1.5">
              <span class="ps-tag">Entregas</span>
              <h1 class="ps-h1 pt-2">{{ portao()?.condominio }}</h1>
              <p class="text-sm text-slate-400">{{ portao()?.portao }}</p>
            </div>

            <div class="ps-panel p-6 sm:p-8 text-center space-y-4" aria-live="polite">
              @switch (estado()?.situacao) {
                @case (undefined) {
                  <div class="py-6">
                    <div class="inline-block w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  </div>
                }
                @case ('aguardando') {
                  <div class="inline-block w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <h2 class="ps-h1">Aguardando o morador</h2>
                  <p class="text-sm text-slate-400">Mantenha esta página aberta: o portão abre por aqui quando o morador liberar.</p>
                }
                @case ('sem_resposta') {
                  <h2 class="ps-h1">Sem resposta</h2>
                  <p class="text-sm text-slate-300">Procure a portaria ou use o interfone.</p>
                  <p class="text-[11px] text-slate-500">Se o morador responder, esta página atualiza sozinha.</p>
                }
                @case ('liberado') {
                  <h2 class="ps-h1">Liberado</h2>
                  <p class="text-sm text-slate-400">O morador liberou a entrada.</p>
                  @if (estado()?.pode_abrir) {
                    <button type="button" (click)="abrir()" [disabled]="abrindo()"
                      class="ps-btn ps-btn-lg w-full disabled:opacity-40 disabled:pointer-events-none">Abrir portão</button>
                  }
                }
                @case ('aberto') {
                  <h2 class="ps-h1">Portão aberto. Pode entrar.</h2>
                  @if (estado()?.pode_sair) {
                    <p class="text-sm text-slate-400">Na saída, se o portão não abrir por dentro, use o botão abaixo.</p>
                    <button type="button" (click)="sair()" [disabled]="abrindo()"
                      class="ps-btn ps-btn-lg w-full disabled:opacity-40 disabled:pointer-events-none">Abrir para sair</button>
                  }
                }
                @case ('liberado_portaria') {
                  <h2 class="ps-h1">Liberado pela portaria. Aguarde a abertura.</h2>
                }
                @case ('vou_buscar') {
                  <h2 class="ps-h1">O morador vai buscar na portaria</h2>
                  <p class="text-sm text-slate-400">Deixe a entrega com a portaria ou aguarde o morador.</p>
                }
                @case ('recusado') {
                  <h2 class="ps-h1">Não autorizado</h2>
                  <p class="text-sm text-slate-400">O morador não autorizou a entrada. Procure a portaria.</p>
                }
                @case ('expirado') {
                  <h2 class="ps-h1">O pedido expirou.</h2>
                  <button type="button" (click)="tentarDeNovo()" class="ps-btn ps-btn-lg w-full">Tentar de novo</button>
                }
              }

              @if (mostrarFalha()) {
                <p class="text-xs text-red-400 border px-3 py-2.5" style="border-color: var(--line-200)" role="alert">
                  Não foi possível abrir, procure a portaria
                </p>
              }
              @if (erro()) {
                <p class="text-xs text-red-400 border px-3 py-2.5" style="border-color: var(--line-200)" role="alert">{{ erro() }}</p>
              }
              @if (semConexao()) {
                <p class="text-xs text-amber-300 border px-3 py-2.5" style="border-color: var(--line-200)" role="status">Sem conexão. Tentando de novo…</p>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class EntregaPageComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private theme = inject(ThemeService);
  private document = inject(DOCUMENT);

  readonly isLight = this.theme.isLight;
  readonly plataformas = PLATAFORMAS;

  readonly fase = signal<'carregando' | 'indisponivel' | 'sem_rede' | 'fora' | 'formulario' | 'acompanhando'>('carregando');
  readonly portao = signal<PortaoPublico | null>(null);
  readonly estado = signal<EstadoEntrega | null>(null);
  readonly erro = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly abrindo = signal(false);
  readonly semConexao = signal(false);
  /** A última tentativa de abrir (entrada ou saída) desta página falhou. */
  private readonly falhaLocal = signal(false);

  // Formulário
  readonly bloco = signal<string | null>(null);
  readonly idApartamento = signal<number | null>(null);
  readonly nome = signal('');
  readonly plataforma = signal<string | null>(null);
  readonly foto = signal<string | null>(null);

  readonly blocos = computed(() => {
    const vistos: string[] = [];
    for (const u of this.portao()?.unidades ?? []) {
      const b = u.bloco ?? '';
      if (!vistos.includes(b)) vistos.push(b);
    }
    return vistos;
  });

  /** Condomínio sem bloco (ou um só): não pergunta o bloco. */
  readonly temBlocos = computed(() => this.blocos().length > 1);

  readonly aptosDoBloco = computed(() => {
    const unidades = this.portao()?.unidades ?? [];
    if (!this.temBlocos()) return unidades;
    const b = this.bloco();
    return b === null ? [] : unidades.filter((u) => (u.bloco ?? '') === b);
  });

  readonly podeEnviar = computed(
    () => !this.enviando() && this.idApartamento() !== null && this.nome().trim().length >= 2 && !!this.foto(),
  );

  readonly mostrarFalha = computed(() => {
    const e = this.estado();
    if (!e) return false;
    if (e.situacao === 'liberado') return this.falhaLocal() || !!e.falha_abertura;
    if (e.situacao === 'aberto') return this.falhaLocal() && e.pode_sair;
    return false;
  });

  private tokenPortao = '';
  private pedido: string | null = null;
  private parado = false;
  private consulta: Subscription | null = null;
  private acao: Subscription | null = null;
  private proxima: ReturnType<typeof setTimeout> | null = null;
  private acompanhandoDesde = 0;

  private readonly aoMudarVisibilidade = () => {
    if (this.parado || this.document.visibilityState !== 'visible') return;
    if (this.fase() !== 'acompanhando' || !this.pedido) return;
    this.consultar();
  };

  ngOnInit() {
    this.tokenPortao = (
      this.route.snapshot.paramMap.get('token') ??
      this.route.snapshot.queryParamMap.get('entrega') ??
      ''
    ).trim();

    if (!this.tokenPortao) {
      this.fase.set('indisponivel');
      return;
    }

    this.document.addEventListener('visibilitychange', this.aoMudarVisibilidade);
    this.carregarPortao();
  }

  carregarPortao() {
    this.fase.set('carregando');
    this.http.get<PortaoPublico>(`${API_BASE}/entrega/publico/${this.tokenPortao}`).subscribe({
      next: (p) => {
        if (this.parado) return;
        this.portao.set(p);
        const guardado = this.lerDaAba();
        if (guardado) {
          // Mesma aba, recarregada: retoma o pedido antes de mostrar o formulário.
          this.pedido = guardado;
          this.comecarAcompanhamento(null);
          return;
        }
        this.fase.set(this.faseSemPedido());
      },
      error: (e: unknown) => {
        if (this.parado) return;
        // 404 = token trocado ou desligado. Rede/5xx: deixa tentar de novo.
        this.fase.set(e instanceof HttpErrorResponse && e.status === 404 ? 'indisponivel' : 'sem_rede');
      },
    });
  }

  ngOnDestroy() {
    this.parado = true;
    this.limparProxima();
    this.consulta?.unsubscribe();
    this.consulta = null;
    this.acao?.unsubscribe();
    this.acao = null;
    this.document.removeEventListener('visibilitychange', this.aoMudarVisibilidade);
  }

  escolherBloco(b: string | null) {
    this.bloco.set(b);
    this.idApartamento.set(null);
  }

  /**
   * Lê a selfie e REDUZ antes de enviar (lado maior 800 px, JPEG 0.8): a
   * API recusa acima de 2 MB em base64, e foto de celular recente passa disso
   * com folga. JPEG sempre: elimina HEIC do iPhone.
   */
  selecionarFoto(evento: Event) {
    const input = evento.target as HTMLInputElement;
    const arquivo = input.files?.[0];
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
        const { largura, altura } = dimensoesReduzidas(img.width, img.height);
        const canvas = this.document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          this.erro.set('Não consegui preparar a foto neste navegador.');
          return;
        }
        ctx.drawImage(img, 0, 0, largura, altura);
        this.foto.set(canvas.toDataURL('image/jpeg', QUALIDADE_FOTO));
        this.erro.set(null);
      };
      img.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(arquivo);
    input.value = '';
  }

  enviar() {
    if (!this.podeEnviar()) return;
    this.enviando.set(true);
    this.erro.set(null);
    this.http
      .post<EstadoEntrega & { pedido: string }>(`${API_BASE}/entrega/publico/${this.tokenPortao}`, {
        id_apartamento: this.idApartamento(),
        nome: this.nome().trim(),
        plataforma: this.plataforma(),
        foto: this.foto(),
      })
      .subscribe({
        next: (r) => {
          this.enviando.set(false);
          if (this.parado) return;
          const { pedido, ...estado } = r;
          this.pedido = pedido;
          this.guardarNaAba(pedido);
          this.comecarAcompanhamento(estado);
        },
        error: (e: unknown) => {
          this.enviando.set(false);
          // 400/403/409/429: a mensagem do servidor já é a frase para o entregador.
          this.erro.set(mensagemDoErro(e, 'Não consegui enviar. Tente de novo.'));
        },
      });
  }

  abrir() {
    this.acionar('abrir');
  }

  sair() {
    this.acionar('sair');
  }

  tentarDeNovo() {
    this.esquecerPedido();
    this.estado.set(null);
    this.erro.set(null);
    this.falhaLocal.set(false);
    this.fase.set(this.faseSemPedido());
  }

  // ------------------------------------------------------------ acompanhamento

  private comecarAcompanhamento(estado: EstadoEntrega | null) {
    this.fase.set('acompanhando');
    this.acompanhandoDesde = Date.now();
    this.erro.set(null);
    this.falhaLocal.set(false);
    if (estado) this.aplicar(estado);
    else this.consultar();
  }

  private consultar() {
    if (this.parado || this.consulta || !this.pedido) return;
    this.limparProxima();
    this.consulta = this.http
      .post<EstadoEntrega>(`${API_BASE}/entrega/publico/${this.tokenPortao}/pedido`, { pedido: this.pedido })
      .pipe(timeout(TEMPO_LIMITE_MS))
      .subscribe({
        next: (e) => {
          this.consulta = null;
          if (this.parado) return;
          this.semConexao.set(false);
          this.aplicar(e);
        },
        error: (e: unknown) => {
          this.consulta = null;
          if (this.parado) return;
          if (e instanceof HttpErrorResponse && e.status === 404) {
            // Pedido que não existe mais (ou o QR foi trocado): volta ao começo.
            const retomando = this.estado() === null;
            this.tentarDeNovo();
            if (!retomando) this.erro.set(mensagemDoErro(e, 'Pedido não encontrado.'));
            return;
          }
          // Rede, tempo esgotado, 429 ou 5xx: segue tentando sem derrubar a tela.
          this.semConexao.set(true);
          this.agendar(NOVA_TENTATIVA_MS);
        },
      });
  }

  private acionar(qual: 'abrir' | 'sair') {
    if (this.parado || this.acao || !this.pedido) return;
    this.limparProxima();
    this.abrindo.set(true);
    this.erro.set(null);
    this.acao = this.http
      .post<EstadoEntrega>(`${API_BASE}/entrega/publico/${this.tokenPortao}/pedido/${qual}`, { pedido: this.pedido })
      .pipe(timeout(TEMPO_LIMITE_MS))
      .subscribe({
        next: (e) => {
          this.acao = null;
          this.abrindo.set(false);
          if (this.parado) return;
          this.falhaLocal.set(e.abriu === false);
          this.aplicar(e, true);
        },
        error: (e: unknown) => {
          this.acao = null;
          this.abrindo.set(false);
          if (this.parado) return;
          this.erro.set(mensagemDoErro(e, 'Não foi possível abrir, procure a portaria'));
          this.agendar(CONSULTA_MS);
        },
      });
  }

  /** Aplica um estado e decide se continua consultando. */
  private aplicar(e: EstadoEntrega, daAcao = false) {
    const antes = this.estado()?.situacao;
    this.estado.set({ ...e, falha_abertura: !!e.falha_abertura });
    if (!daAcao && antes && antes !== e.situacao) this.falhaLocal.set(false);
    if (situacaoFinal(e)) {
      this.esquecerPedido(false);
      this.limparProxima();
      return;
    }
    if (Date.now() - this.acompanhandoDesde > LIMITE_ACOMPANHAMENTO_MS) {
      this.limparProxima();
      return;
    }
    this.agendar(CONSULTA_MS);
  }

  private agendar(ms: number) {
    this.limparProxima();
    if (this.parado) return;
    this.proxima = setTimeout(() => {
      this.proxima = null;
      this.consultar();
    }, ms);
  }

  private limparProxima() {
    if (this.proxima != null) clearTimeout(this.proxima);
    this.proxima = null;
  }

  private faseSemPedido(): 'formulario' | 'fora' {
    return this.portao()?.disponivel ? 'formulario' : 'fora';
  }

  // ------------------------------------------------------------ aba

  private get chave() {
    return `prestare.entrega.${this.tokenPortao}`;
  }

  private lerDaAba(): string | null {
    try {
      return this.document.defaultView?.sessionStorage.getItem(this.chave)?.trim() || null;
    } catch {
      return null;
    }
  }

  private guardarNaAba(pedido: string) {
    try {
      this.document.defaultView?.sessionStorage.setItem(this.chave, pedido);
    } catch {
      /* sem storage: só não sobrevive a recarregar a aba */
    }
  }

  /** Apaga o pedido da aba. `soltar` = a página também deixa de conhecê-lo. */
  private esquecerPedido(soltar = true) {
    if (soltar) {
      this.pedido = null;
      this.limparProxima();
      this.consulta?.unsubscribe();
      this.consulta = null;
    }
    try {
      this.document.defaultView?.sessionStorage.removeItem(this.chave);
    } catch {
      /* nada a apagar */
    }
  }
}

function mensagemDoErro(e: unknown, padrao: string): string {
  const corpo = e instanceof HttpErrorResponse ? e.error : (e as any)?.error;
  const m = corpo?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return padrao;
}
