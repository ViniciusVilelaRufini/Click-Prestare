import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { Subscription, timeout } from 'rxjs';
import qrcode from 'qrcode-generator';
import { API_BASE } from '../shared/api.config';
import { ThemeService } from '../shared/theme.service';

/** Resposta de `GET /passes/publico/:token`. */
export interface PassePublico {
  nome: string;
  condominio: string;
  unidade: string;
  valido_de: string | null;
  valido_ate: string | null;
  codigo: string;
  troca_em_s: number;
}

/** Teto entre duas buscas. A rota aceita 30/min; assim ficam ~4/min. */
const BUSCA_MAX_MS = 25_000;
/** Sem resposta nova, o último QR fica na tela por no máximo isto. */
const QR_VALE_NA_TELA_MS = 30_000;
/** Depois de uma falha de rede, tenta de novo neste intervalo. */
const NOVA_TENTATIVA_MS = 5_000;
/** Busca que não responde vira falha de rede (o QR não pode esperar). */
const TEMPO_LIMITE_MS = 10_000;
/** Cópia do token nesta aba, para sobreviver a recarregar a página. */
const CHAVE_ABA = 'prestare_passe_token';
/** Margem branca obrigatória do QR, em módulos. */
const MARGEM_MODULOS = 4;

/**
 * Página que o VISITANTE abre pelo link do passe (WhatsApp). Não exige conta.
 *
 * Mostra o QR do código dinâmico que a API gera a cada 30 s. O segredo nunca
 * vem para o navegador: a página só busca o código atual, e um print deixa de
 * abrir em pouco tempo. Por isso:
 *
 *  - busca de novo quando a contagem chega a zero ou a cada 25 s, o que vier
 *    primeiro, e na hora em que a aba volta ao primeiro plano — o navegador
 *    pausa temporizadores em segundo plano, e um QR vencido na tela é o pior
 *    momento possível (o visitante está na frente do leitor);
 *  - sem rede, mantém o último QR por no máximo 30 s desde que chegou, com
 *    aviso; passado isso, esconde em vez de mostrar algo que vai ser negado;
 *  - 404 é a mesma tela para todo motivo (link cancelado, visita encerrada,
 *    opção desligada): a página não ajuda a descobrir quais links existem.
 *
 * O token chega no fragmento da URL (`/#passe=…`), sai da barra assim que é
 * lido e vai à API no corpo de um POST. Nada aqui fala com terceiros: o QR é
 * desenhado no próprio navegador (qrcode-generator → SVG), não há imagem nem
 * link externo, e a página pede `no-referrer` para o navegador não repassar a
 * URL.
 *
 * Visual: o mesmo vocabulário Prestare Dark do convite (`app-bg`, `ps-*`). O
 * QR fica sempre em fundo branco — leitor nenhum lê QR invertido.
 */
@Component({
  selector: 'app-passe-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen app-bg font-sans transition-colors duration-500 px-4 py-8 sm:py-12">
      <div class="w-full max-w-md mx-auto space-y-6">

        <!-- Marca, no mesmo formato do convite e da tela de login -->
        <div class="ps-brand justify-center">
          <img [src]="isLight() ? '/prestare-marca-preta.svg' : '/prestare-marca-branca.svg'" alt="Prestare Gestão" />
          <div>
            <div class="ps-brand-wm">PRESTARE <span>GESTÃO</span></div>
            <div class="ps-label mt-1" style="font-size: 9px; line-height: 10px;">Passe de acesso</div>
          </div>
        </div>

        @if (indisponivel()) {
          <div class="ps-panel p-8 text-center space-y-3">
            <div class="w-14 h-14 border flex items-center justify-center mx-auto" style="border-color: var(--line-200)">
              <svg class="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              </svg>
            </div>
            <h1 class="ps-h1">Passe indisponível</h1>
            <p class="text-sm text-slate-400">
              Este passe expirou ou foi cancelado. Peça um novo para quem te convidou.
            </p>
          </div>
        } @else if (dados(); as d) {

          <div class="text-center space-y-1.5">
            <span class="ps-tag">Passe de visitante</span>
            <h1 class="ps-h1 pt-2">{{ d.condominio }}</h1>
            <p class="text-sm text-slate-400">{{ d.unidade }}</p>
          </div>

          <div class="ps-panel p-5 sm:p-6 space-y-5 text-center">
            <p class="text-sm text-slate-300">
              Olá, <strong class="text-white font-semibold">{{ d.nome }}</strong>. Mostre este QR no leitor da portaria.
            </p>

            <div
              data-qr-moldura
              class="mx-auto flex items-center justify-center"
              style="background: #fff; width: 280px; max-width: 100%; min-width: 240px; aspect-ratio: 1 / 1;">
              @if (qr(); as q) {
                <svg
                  data-qr-passe
                  [attr.viewBox]="'0 0 ' + q.lado + ' ' + q.lado"
                  class="block w-full h-full"
                  shape-rendering="crispEdges"
                  role="img"
                  aria-label="QR do passe de acesso">
                  <rect width="100%" height="100%" fill="#fff" />
                  <path [attr.d]="q.d" fill="#000" />
                </svg>
              } @else {
                <div class="inline-block w-7 h-7 border-2 rounded-full animate-spin" style="border-color: #d4d4d4; border-top-color: #111"></div>
              }
            </div>

            @if (semConexao()) {
              <p class="text-xs text-amber-300 border px-3 py-2.5" style="border-color: var(--line-200)" role="status">
                Sem conexão. Tentando de novo…
              </p>
            } @else if (qr()) {
              <p class="text-xs text-slate-400" aria-live="polite">
                @if (restante() > 0) {
                  Novo código em {{ restante() }} s
                } @else {
                  Atualizando o código…
                }
              </p>
            } @else {
              <p class="text-xs text-slate-400">Atualizando o código…</p>
            }

            @if (d.valido_de || d.valido_ate) {
              <dl class="pt-4 border-t space-y-2 text-sm text-left" style="border-color: var(--line-200)">
                @if (d.valido_de) {
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-400">Válido a partir de</dt>
                    <dd class="font-medium text-slate-200">{{ d.valido_de | date: "dd/MM 'às' HH:mm" }}</dd>
                  </div>
                }
                @if (d.valido_ate) {
                  <div class="flex items-center justify-between gap-3">
                    <dt class="text-slate-400">Válido até</dt>
                    <dd class="font-medium text-slate-200">{{ d.valido_ate | date: "dd/MM 'às' HH:mm" }}</dd>
                  </div>
                }
              </dl>
            }
          </div>

          <p class="text-center text-[11px] text-slate-500">
            O QR muda sozinho. Um print não abre o portão: mantenha esta página aberta.
          </p>
        } @else if (semConexao()) {
          <div class="ps-panel p-8 text-center space-y-3">
            <h1 class="ps-h1">Passe de acesso</h1>
            <p class="text-sm text-amber-300" role="status">Sem conexão. Tentando de novo…</p>
          </div>
        } @else {
          <div class="py-24 text-center">
            <div class="inline-block w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          </div>
        }
      </div>
    </div>
  `,
})
export class PassePageComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private theme = inject(ThemeService);
  private document = inject(DOCUMENT);

  readonly isLight = this.theme.isLight;

  readonly indisponivel = signal(false);
  readonly semConexao = signal(false);
  readonly dados = signal<PassePublico | null>(null);
  /** Instante (Date.now) em que o código atual chegou. */
  private readonly recebidoEm = signal<number | null>(null);
  /** Relógio da tela, andando de segundo em segundo. */
  private readonly agora = signal(Date.now());

  /** O último código ainda pode ficar na tela? (no máximo 30 s desde que chegou) */
  private readonly codigoNaTela = computed(() => {
    const d = this.dados();
    const em = this.recebidoEm();
    if (!d?.codigo || em == null) return null;
    return this.agora() - em <= QR_VALE_NA_TELA_MS ? d.codigo : null;
  });

  readonly qr = computed(() => {
    const codigo = this.codigoNaTela();
    return codigo ? desenharQr(codigo) : null;
  });

  readonly restante = computed(() => {
    const d = this.dados();
    const em = this.recebidoEm();
    if (!d || em == null) return 0;
    return Math.max(0, d.troca_em_s - Math.floor((this.agora() - em) / 1000));
  });

  private token = '';
  private parado = false;
  private busca: Subscription | null = null;
  private proxima: ReturnType<typeof setTimeout> | null = null;
  private relogio: ReturnType<typeof setInterval> | null = null;
  private metaReferrer: HTMLMetaElement | null = null;

  private readonly aoMudarVisibilidade = () => {
    if (this.parado || this.document.visibilityState !== 'visible') return;
    // Volta do segundo plano: o relógio da tela anda na hora (o QR velho some
    // se passou do prazo) e o código é buscado sem esperar o temporizador.
    this.agora.set(Date.now());
    this.buscar();
  };

  ngOnInit() {
    this.pedirSemReferrer();

    this.token = this.lerToken();

    // Link cortado ao copiar do WhatsApp: mesma tela de qualquer passe
    // inválido, sem gastar chamada e sem ficar em branco.
    if (!this.token) {
      this.parar();
      this.indisponivel.set(true);
      return;
    }

    this.document.addEventListener('visibilitychange', this.aoMudarVisibilidade);
    this.relogio = setInterval(() => this.agora.set(Date.now()), 1000);
    this.buscar();
  }

  ngOnDestroy() {
    this.parar();
    this.metaReferrer?.remove();
    this.metaReferrer = null;
  }

  private buscar() {
    if (this.parado || this.busca) return;
    this.limparProxima();

    // POST com o token no corpo: na URL ele ficaria nos logs de acesso do
    // CloudFront e do nginx.
    this.busca = this.http
      .post<PassePublico>(`${API_BASE}/passes/publico`, { token: this.token })
      .pipe(timeout(TEMPO_LIMITE_MS))
      .subscribe({
        next: (d) => {
          this.busca = null;
          if (this.parado) return;
          const agora = Date.now();
          this.dados.set(d);
          this.recebidoEm.set(agora);
          this.agora.set(agora);
          this.semConexao.set(false);
          const troca = Number.isFinite(d?.troca_em_s) ? Math.max(1, d.troca_em_s) : 1;
          this.agendar(Math.min(troca * 1000, BUSCA_MAX_MS));
        },
        error: (e: unknown) => {
          this.busca = null;
          if (this.parado) return;
          if (e instanceof HttpErrorResponse && e.status === 404) {
            this.parar();
            this.guardarNaAba(null);
            this.dados.set(null);
            this.indisponivel.set(true);
            return;
          }
          // Rede, tempo esgotado, 429 ou 5xx: segue tentando, sem derrubar a tela.
          this.semConexao.set(true);
          this.agora.set(Date.now());
          this.agendar(NOVA_TENTATIVA_MS);
        },
      });
  }

  private agendar(ms: number) {
    this.limparProxima();
    this.proxima = setTimeout(() => {
      this.proxima = null;
      this.buscar();
    }, ms);
  }

  private limparProxima() {
    if (this.proxima != null) clearTimeout(this.proxima);
    this.proxima = null;
  }

  private parar() {
    this.parado = true;
    this.limparProxima();
    if (this.relogio != null) clearInterval(this.relogio);
    this.relogio = null;
    this.busca?.unsubscribe();
    this.busca = null;
    this.document.removeEventListener('visibilitychange', this.aoMudarVisibilidade);
  }

  /**
   * Token do passe. O link gerado é `/#passe=<token>`: o fragmento não vai ao
   * servidor, então não cai em log de acesso. `?passe=` e `passe/:token`
   * continuam aceitos por compatibilidade.
   *
   * Lido o token, ele sai da barra de endereço (`history.replaceState`) para
   * não ficar no histórico do navegador, e fica só nesta aba
   * (sessionStorage): o celular recarrega aba em segundo plano, e sem isso o
   * visitante na frente do leitor cairia em "Passe indisponível". A URL vira
   * `/#passe`, que continua abrindo esta página e lê a cópia da aba.
   */
  private lerToken(): string {
    const snap = this.route.snapshot;
    const fragmento = snap.fragment ?? this.document.defaultView?.location.hash.replace(/^#/, '') ?? '';
    const doFragmento = new URLSearchParams(fragmento).get('passe');
    const daUrl = (snap.paramMap.get('token') ?? snap.queryParamMap.get('passe') ?? doFragmento ?? '').trim();

    if (daUrl) {
      this.guardarNaAba(daUrl);
      this.limparBarraDeEndereco();
      return daUrl;
    }
    try {
      return (this.document.defaultView?.sessionStorage.getItem(CHAVE_ABA) ?? '').trim();
    } catch {
      return '';
    }
  }

  private guardarNaAba(token: string | null) {
    try {
      const s = this.document.defaultView?.sessionStorage;
      if (token) s?.setItem(CHAVE_ABA, token);
      else s?.removeItem(CHAVE_ABA);
    } catch {
      /* sem storage: só não sobrevive a recarregar a aba */
    }
  }

  private limparBarraDeEndereco() {
    try {
      const w = this.document.defaultView;
      w?.history.replaceState(w.history.state, '', '/#passe');
    } catch {
      /* navegador sem History API: o token só fica na barra */
    }
  }

  /** O token esteve na URL: o navegador não deve repassá-la a ninguém. */
  private pedirSemReferrer() {
    const head = this.document.head;
    if (!head || head.querySelector('meta[name="referrer"]')) return;
    const meta = this.document.createElement('meta');
    meta.setAttribute('name', 'referrer');
    meta.setAttribute('content', 'no-referrer');
    head.appendChild(meta);
    this.metaReferrer = meta;
  }
}

/**
 * QR em SVG, desenhado aqui mesmo. Nível M; modo alfanumérico, porque o
 * código (`P1` + base32 maiúsculo) cabe nele e o QR sai menos denso — leitor
 * barato lê melhor. A margem de 4 módulos faz parte do desenho.
 */
function desenharQr(codigo: string): { lado: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(codigo, /^[0-9A-Z $%*+\-./:]*$/.test(codigo) ? 'Alphanumeric' : 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + MARGEM_MODULOS},${r + MARGEM_MODULOS}h1v1h-1z`;
    }
  }
  return { lado: n + MARGEM_MODULOS * 2, d };
}
