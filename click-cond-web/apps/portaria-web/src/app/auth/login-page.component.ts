import { Component, inject, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService, ehDesafioMfa, type CondominioVinculo } from './auth.service';
import { ThemeService } from '../shared/theme.service';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login fixed inset-0 grid grid-cols-2 max-[899px]:grid-cols-1 max-[899px]:auto-rows-min max-[899px]:overflow-y-auto app-bg font-sans">

      <!-- Painel esquerdo: apresentação -->
      <div class="login-left relative flex flex-col justify-between gap-6 overflow-hidden border-r max-[899px]:border-r-0 max-[899px]:border-b px-16 py-14 max-[899px]:px-4 max-[899px]:py-8" style="border-color: var(--line-100)">

        <!-- Marca + Powered by AWS: separado da marca por divisória (regra de marca da AWS: não formar logo combinado) -->
        <div class="flex flex-wrap items-center gap-y-3">
          <div class="ps-brand">
            <img [src]="isLight() ? '/prestare-marca-preta.svg' : '/prestare-marca-branca.svg'" alt="Prestare Gestão" />
            <div>
              <div class="ps-brand-wm">PRESTARE <span>GESTÃO</span></div>
              <div class="ps-label mt-1" style="font-size: 9px; line-height: 10px;">Web Console</div>
            </div>
          </div>
          <div class="ml-5 pl-5 border-l shrink-0 flex items-center" style="border-color: var(--line-100)">
            <img [src]="isLight() ? '/powered-by-aws-gray.svg' : '/powered-by-aws-white.svg'" alt="Powered by AWS" width="124" height="22" class="block h-[22px] w-auto" />
          </div>
        </div>

        <!-- Mensagem principal -->
        <div class="max-w-xl my-auto py-8">
          <span class="ps-tag">Console Portaria Inteligente</span>
          <h2 class="login-hero">
            A inteligência operacional que <span>conecta seu condomínio</span>
          </h2>
          <p class="text-sm leading-relaxed max-w-md" style="color: var(--ink-muted)">
            Acesse a plataforma corporativa oficial da Prestare Portaria e gerencie fluxos de correspondências, visitantes, prestadores de serviços e ocorrências com rastreabilidade absoluta e conformidade corporativa.
          </p>

          <div class="login-feats">
            <div>
              <svg class="w-4 h-4 shrink-0" style="color: var(--ink-muted)" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
              <span>Controle de Acesso</span>
            </div>
            <div>
              <svg class="w-4 h-4 shrink-0" style="color: var(--ink-muted)" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
              <span>Gestão de Encomendas</span>
            </div>
            <div>
              <svg class="w-4 h-4 shrink-0" style="color: var(--ink-muted)" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
              <span>Ocorrências Ativas</span>
            </div>
            <div>
              <svg class="w-4 h-4 shrink-0" style="color: var(--ink-muted)" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
              <span>Relatórios Gerenciais</span>
            </div>
          </div>
        </div>

        <!-- Rodapé corporativo -->
        <div class="text-xs flex flex-wrap justify-between items-center gap-x-6 gap-y-1" style="color: var(--ink-subtle)">
          <span>© 2026 Prestare Gestão e Tecnologia. Todos os direitos reservados.</span>
          <a href="https://prestaregestao.com.br/novo/" target="_blank" class="hover:text-[var(--ink)] transition">prestaregestao.com.br</a>
        </div>
      </div>

      <!-- Painel direito: formulário ou QR Code -->
      <div class="relative flex items-center justify-center px-12 py-12 max-[899px]:px-4 max-[899px]:pt-8 max-[899px]:pb-12">

        <!-- Botão de Alternar Tema -->
        <button
          type="button"
          (click)="toggleTheme()"
          class="ps-ibtn absolute top-6 right-6 border"
          style="border-color: var(--line-200)"
          title="Alternar Tema"
          aria-label="Alternar Tema"
        >
          @if (isLight()) {
            <!-- Modo claro ativo: mostra a lua (mudar para escuro) -->
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
            </svg>
          } @else {
            <!-- Modo escuro ativo: mostra o sol (mudar para claro) -->
            <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="4" />
              <path stroke-linecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
            </svg>
          }
        </button>

        <div class="w-full max-w-[420px] flex flex-col gap-5">

          <p class="min-[900px]:hidden text-xs" style="color: var(--ink-muted)">
            Acesso restrito ao console de portaria
          </p>

          <!-- MODO CONVENCIONAL DE LOGIN -->
          <!-- ESQUECI A SENHA -->
          @if (recuperando()) {
            <form (ngSubmit)="enviarRecuperacao()" class="flex flex-col gap-5 animate-fadeIn">
              <div class="space-y-2">
                <h2 class="login-title">Recuperar senha</h2>
                <p class="text-sm" style="color: var(--ink-muted)">
                  Informe o e-mail de acesso. Enviamos um link para criar uma senha nova.
                </p>
              </div>

              <div class="ps-seg">
                <button type="button" [class.on]="papelRecuperacao() === 'funcionario'" (click)="papelRecuperacao.set('funcionario')">Porteiro</button>
                <button type="button" [class.on]="papelRecuperacao() === 'sindico'" (click)="papelRecuperacao.set('sindico')">Síndico</button>
              </div>

              <div class="ps-field">
                <input
                  type="email"
                  [(ngModel)]="emailRecuperacao"
                  name="emailRecuperacao"
                  autocomplete="username"
                  placeholder="seu@email.com"
                  required
                />
              </div>

              @if (msgRecuperacao()) {
                <div class="flex items-center gap-2.5 text-xs border px-4 py-3" style="border-color: var(--line-200); color: var(--ink-muted)" role="status">
                  <span>{{ msgRecuperacao() }}</span>
                </div>
              }
              @if (erro()) {
                <div class="flex items-center gap-2.5 text-xs text-rose-400 border px-4 py-3" style="border-color: var(--line-200)" role="alert">
                  <span class="ps-dot ps-dot-danger"></span>
                  <span>{{ erro() }}</span>
                </div>
              }

              <button type="submit" [disabled]="carregando()" class="ps-btn ps-btn-lg w-full disabled:opacity-50 disabled:cursor-not-allowed">
                {{ carregando() ? 'Enviando...' : 'Enviar link' }}
              </button>
              <button type="button" (click)="fecharRecuperacao()" class="ps-label hover:text-[var(--ink)] transition">
                Voltar para o login
              </button>
            </form>
          }

          @if (!isQrMode() && !mfaToken() && !recuperando()) {
            <div class="space-y-2">
              <h2 class="login-title">Painel de Acesso</h2>
              <p class="text-sm" style="color: var(--ink-muted)">
                Entre com as suas credenciais para iniciar o turno.
              </p>
            </div>

            <form (ngSubmit)="onSubmit()" class="flex flex-col gap-5">

              <div class="space-y-2">
                <label class="ps-label block">Identificador / Usuário</label>
                <div class="ps-field">
                  <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                  </svg>
                  <input
                    type="text"
                    [(ngModel)]="loginValue"
                    name="login"
                    autocomplete="username"
                    placeholder="Ex: portaria_centro"
                    required
                  />
                </div>
              </div>

              <div class="space-y-2">
                <label class="ps-label block">Senha de Segurança</label>
                <div class="ps-field">
                  <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                  </svg>
                  <input
                    type="password"
                    [(ngModel)]="senhaValue"
                    name="senha"
                    autocomplete="current-password"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <!-- Erro de Login -->
              @if (erro()) {
                <div class="flex items-center gap-2.5 text-xs text-rose-400 border px-4 py-3 animate-fadeIn" style="border-color: var(--line-200)" role="alert">
                  <span class="ps-dot ps-dot-danger"></span>
                  <span>{{ erro() }}</span>
                </div>
              }

              <div class="flex justify-end -mt-2">
                <button type="button" (click)="abrirRecuperacao()" class="ps-label hover:text-[var(--ink)] transition">Esqueci a senha</button>
              </div>

              <!-- Botão Entrar -->
              <button
                type="submit"
                [disabled]="carregando()"
                class="ps-btn ps-btn-lg w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                @if (carregando()) {
                  <span class="flex items-center justify-center gap-2">
                    <div class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    <span>Processando Acesso...</span>
                  </span>
                } @else {
                  <span>Entrar no Sistema</span>
                  <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-6-6l6 6-6 6"/>
                  </svg>
                }
              </button>

              <!-- Divisor Visual para Opção QR Code -->
              <div class="flex items-center gap-3">
                <div class="flex-1 h-px" style="background: var(--line-100)"></div>
                <span class="ps-label">Ou acesse pelo celular</span>
                <div class="flex-1 h-px" style="background: var(--line-100)"></div>
              </div>

              <!-- Botão Entrar via QR Code -->
              <button
                type="button"
                (click)="toggleQrMode(true)"
                class="ps-btn ps-btn-sec ps-btn-lg w-full"
              >
                <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M4 8h4m-4 4h.01M4 16h4m-4 4h.01M6 4h.01M6 16h.01M6 20h.01" />
                </svg>
                <span>Acessar via QR Code (App)</span>
              </button>
            </form>
          }

          <!-- SEGUNDA ETAPA DO SÍNDICO: CÓDIGO ENVIADO POR E-MAIL -->
          @if (mfaToken()) {
            <form (ngSubmit)="onSubmitMfa()" class="flex flex-col gap-5 animate-fadeIn">
              <div class="space-y-2">
                <h2 class="login-title">Verificação em duas etapas</h2>
                <p class="text-sm" style="color: var(--ink-muted)">
                  Enviamos um código de 6 dígitos para {{ mfaEmail() }}.
                </p>
              </div>

              <div class="ps-field" style="height: 48px">
                <input
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="6"
                  [(ngModel)]="codigoMfa"
                  name="codigoMfa"
                  required
                  class="text-center text-lg tracking-[0.5em]"
                  placeholder="000000"
                />
              </div>

              <label class="flex items-center gap-2 text-xs" style="color: var(--ink-muted)">
                <input type="checkbox" [(ngModel)]="lembrarDispositivo" name="lembrarDispositivo" />
                Confiar neste computador por 30 dias
              </label>

              @if (erro()) {
                <div class="flex items-center gap-2.5 text-xs text-rose-400 border px-4 py-3" style="border-color: var(--line-200)" role="alert">
                  <span class="ps-dot ps-dot-danger"></span>
                  <span>{{ erro() }}</span>
                </div>
              }

              <button
                type="submit"
                [disabled]="carregando()"
                class="ps-btn ps-btn-lg w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {{ carregando() ? 'Verificando...' : 'Confirmar código' }}
              </button>

              <div class="flex justify-between">
                <button type="button" (click)="cancelarMfa()" class="ps-label hover:text-[var(--ink)] transition">Voltar</button>
                <button type="button" (click)="reenviarCodigo()" class="ps-label hover:text-[var(--ink)] transition">Reenviar código</button>
              </div>
            </form>
          }

          <!-- MODO QR CODE DE LOGIN -->
          @if (isQrMode()) {
            <div class="flex flex-col gap-6 text-center animate-fadeIn">
              <div class="space-y-2 text-left">
                <h2 class="login-title">Entrar com QR Code</h2>
                <p class="text-sm leading-relaxed" style="color: var(--ink-muted)">
                  Escaneie o código abaixo com a câmera do seu celular através do aplicativo <strong>Click Condomínio</strong> para se conectar automaticamente.
                </p>
              </div>

              <!-- Container do QR Code: papel branco nos dois temas -->
              <div class="qr-paper relative w-64 h-64 mx-auto border flex items-center justify-center overflow-hidden" style="border-color: var(--line-200)">
                @if (qrToken()) {
                  @if (qrExpired()) {
                    <div class="absolute inset-0 flex flex-col items-center justify-center gap-3" style="background: color-mix(in srgb, var(--bg-000) 92%, transparent)">
                      <span class="ps-label" style="color: var(--ink)">QR Code Expirado</span>
                      <button type="button" (click)="gerarNovoQr()" class="ps-btn ps-btn-sm">Recarregar</button>
                    </div>
                  }
                  <img
                    [src]="'https://api.qrserver.com/v1/create-qr-code/?size=250x250&color=000000&bgcolor=ffffff&data=' + qrToken()"
                    alt="QR Code de Acesso"
                    class="w-52 h-52"
                  />
                } @else {
                  <div class="flex flex-col items-center gap-2.5" style="color: #000">
                    <div class="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    <span class="ps-label" style="color: #000">Gerando código seguro...</span>
                  </div>
                }
              </div>

              <!-- Status do Polling -->
              <div class="flex items-center justify-center gap-2.5 text-xs" style="color: var(--ink-muted)">
                @if (!qrExpired()) {
                  <span class="ps-dot ps-dot-ink ps-dot-pulse"></span>
                  <span>Aguardando leitura do celular...</span>
                } @else {
                  <span class="ps-dot ps-dot-danger"></span>
                  <span>Código expirado. Por favor, recarregue.</span>
                }
              </div>

              <!-- Instruções (Passo a Passo) -->
              <div class="ps-panel p-4 text-left space-y-3">
                <div class="flex items-start gap-2.5">
                  <span class="login-step">1</span>
                  <p class="text-xs" style="color: var(--ink-muted)">Abra o app no celular como <strong>Síndico</strong> ou <strong>Porteiro</strong>.</p>
                </div>
                <div class="flex items-start gap-2.5">
                  <span class="login-step">2</span>
                  <p class="text-xs" style="color: var(--ink-muted)">Acesse o menu <strong>Configurações</strong> e toque em <strong>Acesso Web por QR Code</strong>.</p>
                </div>
                <div class="flex items-start gap-2.5">
                  <span class="login-step">3</span>
                  <p class="text-xs" style="color: var(--ink-muted)">Aponte a câmera para o QR Code acima e confirme no celular.</p>
                </div>
              </div>

              <!-- Botão Voltar -->
              <button type="button" (click)="toggleQrMode(false)" class="ps-label hover:text-[var(--ink)] transition">
                Voltar para Login convencional
              </button>
            </div>
          }

        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-left::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(var(--grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--grid) 1px, transparent 1px);
      background-size: 64px 64px;
      -webkit-mask-image: linear-gradient(180deg, #000, transparent 85%);
      mask-image: linear-gradient(180deg, #000, transparent 85%);
      pointer-events: none;
    }
    .login-left > * { position: relative; }
    .login-hero {
      font-family: var(--font-display);
      font-weight: 600;
      font-size: clamp(44px, 5.4vw, 84px);
      line-height: 0.92;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      margin: 20px 0 24px;
      text-wrap: balance;
    }
    .login-hero span { font-weight: 300; color: var(--ink-muted); }
    .login-feats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 220px));
      gap: 14px 32px;
      margin-top: 32px;
    }
    .login-feats div { display: flex; gap: 10px; align-items: center; font-size: 14px; }
    .login-title {
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 30px;
      line-height: 34px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin: 0;
    }
    .login-step {
      width: 16px;
      height: 16px;
      margin-top: 2px;
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--line-200);
      font-size: 10px;
      font-weight: 600;
      color: var(--ink);
    }
    @media (max-width: 899px) {
      .login-feats { grid-template-columns: 1fr 1fr; gap: 12px; }
    }
    @media (max-width: 520px) {
      .login-feats { grid-template-columns: 1fr; }
    }
  `],
})
export class LoginPageComponent implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private theme = inject(ThemeService);

  loginValue = '';
  senhaValue = '';
  carregando = signal(false);
  erro = signal('');
  // Segunda etapa do síndico (código por e-mail)
  mfaToken = signal('');
  mfaEmail = signal('');
  codigoMfa = '';
  // Desmarcado por padrão: o PC da portaria costuma ser compartilhado entre turnos.
  lembrarDispositivo = false;
  // Esqueci a senha
  recuperando = signal(false);
  papelRecuperacao = signal<'funcionario' | 'sindico'>('funcionario');
  emailRecuperacao = '';
  msgRecuperacao = signal('');

  // Theme State
  readonly isLight = this.theme.isLight;

  // QR Code States
  isQrMode = signal(false);
  qrToken = signal('');
  qrExpired = signal(false);
  private pollingTimer: any = null;

  constructor() {}

  ngOnDestroy() {
    this.clearPolling();
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  onSubmit() {
    if (!this.loginValue || !this.senhaValue) return;
    this.carregando.set(true);
    this.erro.set('');

    this.auth.login(this.loginValue, this.senhaValue).subscribe({
      next: (res) => {
        if (ehDesafioMfa(res)) {
          this.carregando.set(false);
          this.mfaEmail.set(res.email_masked);
          this.mfaToken.set(res.mfa_token);
          return;
        }
        this.router.navigate([this.destinoPosLogin()]);
      },
      error: (err) => {
        this.carregando.set(false);
        // 400/503 (síndico sem e-mail, falha ao enviar o código) trazem o motivo em `message`. No 401, a trava por
        // tentativas e o síndico sem condomínio ativo também: só a recusa genérica vira o texto fixo.
        const msgApi = typeof err?.error?.message === 'string' ? err.error.message : '';
        this.erro.set(
          err.status === 401
            ? msgApi && msgApi !== 'Credenciais inválidas.' ? msgApi : 'Login ou senha incorretos'
            : msgApi || 'Falha na conexão com o servidor',
        );
      },
    });
  }

  abrirRecuperacao() {
    this.erro.set('');
    this.msgRecuperacao.set('');
    this.emailRecuperacao = this.loginValue.includes('@') ? this.loginValue.trim() : '';
    this.recuperando.set(true);
  }

  fecharRecuperacao() {
    this.erro.set('');
    this.msgRecuperacao.set('');
    this.recuperando.set(false);
  }

  /**
   * Pedido do link de redefinição (a página /redefinir-senha conclui). Porteiro: a senha do login de portaria;
   * síndico: a senha da conta. A resposta é a mesma exista ou não o e-mail.
   */
  enviarRecuperacao() {
    const email = this.emailRecuperacao.trim();
    if (!email) return;
    this.carregando.set(true);
    this.erro.set('');
    this.msgRecuperacao.set('');
    const rota = this.papelRecuperacao() === 'sindico' ? '/api/sindico/recovery-password' : '/api/funcionarios/recovery-password';
    this.http.post<{ success: boolean; message: string }>(rota, { email }).subscribe({
      next: (res) => {
        this.carregando.set(false);
        this.msgRecuperacao.set(res?.message || 'Se o e-mail estiver cadastrado, enviamos as instruções para redefinição.');
      },
      error: (e) => {
        this.carregando.set(false);
        this.erro.set(e?.error?.message ?? e?.message ?? 'Não foi possível enviar o pedido.');
      },
    });
  }

  onSubmitMfa() {
    const codigo = this.codigoMfa.trim();
    if (!codigo) return;
    this.carregando.set(true);
    this.erro.set('');

    this.auth.verificarMfa(this.mfaToken(), codigo, this.lembrarDispositivo).subscribe({
      next: () => {
        this.mfaToken.set('');
        this.codigoMfa = '';
        this.router.navigate([this.destinoPosLogin()]);
      },
      error: (err) => {
        this.carregando.set(false);
        this.erro.set(err?.error?.message || 'Código inválido ou expirado.');
      },
    });
  }

  reenviarCodigo() {
    this.erro.set('');
    this.auth.reenviarMfa(this.mfaToken()).subscribe({
      error: (err) => this.erro.set(err?.error?.message || 'Não foi possível reenviar o código.'),
    });
  }

  cancelarMfa() {
    this.mfaToken.set('');
    this.codigoMfa = '';
    this.erro.set('');
  }

  /**
   * Síndico com mais de um condomínio precisa dizer em qual quer entrar — antes
   * a web escolhia o primeiro vínculo sozinha. Porteiro e síndico de um só
   * condomínio seguem direto para o console.
   */
  private destinoPosLogin(): string {
    return this.auth.temMultiplosCondominios() ? '/selecionar-condominio' : '/';
  }

  toggleQrMode(active: boolean) {
    this.isQrMode.set(active);
    this.erro.set('');
    if (active) {
      this.iniciarSessaoQr();
    } else {
      this.clearPolling();
    }
  }

  gerarNovoQr() {
    this.iniciarSessaoQr();
  }

  private iniciarSessaoQr() {
    this.clearPolling();
    this.qrToken.set('');
    this.qrExpired.set(false);

    this.http.post<{ qrToken: string; expiresAt: string }>('/api/auth/qr/session', {}).subscribe({
      next: (res) => {
        this.qrToken.set(res.qrToken);
        this.startPolling(res.qrToken);
      },
      error: () => {
        this.erro.set('Falha ao gerar sessão de QR Code.');
        this.isQrMode.set(false);
      }
    });
  }

  private startPolling(token: string) {
    this.pollingTimer = setInterval(() => {
      this.http.get<{ status: string; access_token?: string; id?: number; nome?: string; turno?: string; id_condominio?: number; condominio_nome?: string; condominios?: CondominioVinculo[] }>(`/api/auth/qr/status/${token}`).subscribe({
        next: (res) => {
          if (res.status === 'confirmed' && res.access_token) {
            this.clearPolling();
            // Sem condomínio ou sem papel não há sessão a montar: antes virava "Turno QR" (tratado como porteiro)
            // no condomínio 1.
            if (!res.id_condominio || !res.turno) {
              this.erro.set('Não foi possível concluir o acesso pelo QR Code. Gere um novo código.');
              this.qrExpired.set(true);
              return;
            }
            this.auth.loginComToken({
              access_token: res.access_token,
              id: res.id,
              nome: res.nome || 'Usuário Conectado',
              turno: res.turno,
              id_condominio: res.id_condominio,
              condominio_nome: res.condominio_nome,
              // Síndico pelo QR também ganha o seletor de condomínio.
              condominios: res.condominios ?? [],
            });
            this.router.navigate([this.destinoPosLogin()]);
          } else if (res.status === 'expired') {
            this.clearPolling();
            this.qrExpired.set(true);
          }
        },
        error: () => {
          this.clearPolling();
          this.qrExpired.set(true);
        }
      });
    }, 1500);
  }

  private clearPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}