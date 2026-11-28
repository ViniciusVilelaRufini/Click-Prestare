import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../auth/auth.service';
import { ehPorteiro, papelDoToken } from '../auth/papel';
import { ConfirmService } from '../shared/confirm.service';
import { API_BASE } from '../shared/api.config';
import { TerminaisFaciaisPageComponent } from '../terminais-faciais/terminais-faciais-page.component';
import { RegrasAcessoComponent } from './regras-acesso/regras-acesso.component';
import { CaminhoLeitoresComponent } from './caminho-leitores/caminho-leitores.component';
import { EquipePortariaComponent } from './equipe-portaria/equipe-portaria.component';
import { InterfoneConfigComponent } from './interfone/interfone-config.component';
import { InterfoneApi } from '../interfone/interfone.api';

import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';

/** Aviso mostrado antes de ligar o QR no app (texto do plano, sem variação). */
export const AVISO_QR_APP =
  'O QR depende da internet do condomínio. Antes de ligar, confirme que todo morador sem rosto cadastrado tem tag ou que há porteiro. Com a opção ligada, o PIN do visitante deixa de abrir quando mostrado como QR no leitor; continua valendo digitado na portaria.';

/** Aviso mostrado antes de ligar o passe na carteira (texto do plano, sem variação). */
export const AVISO_WALLET =
  'O passe na carteira abre sem o app e, no iPhone, até com a tela bloqueada. O código muda uma vez por dia, então é menos seguro que o QR do app: um print vale até o dia seguinte, e uma cópia do passe continua recebendo o código novo até alguém cancelar. Se um morador perder o celular, cancele o passe dele em Moradores.';

type OpcaoCredenciais = { qr_app_habilitado: boolean; wallet_habilitado?: boolean };

@Component({
  selector: 'app-configuracoes-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TerminaisFaciaisPageComponent,
    RegrasAcessoComponent,
    CaminhoLeitoresComponent,
    EquipePortariaComponent,
    InterfoneConfigComponent,
    SlideIndicatorDirective,
  ],
  templateUrl: './configuracoes-page.component.html',
})
export class ConfiguracoesPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly confirm = inject(ConfirmService);
  private readonly interfoneApi = inject(InterfoneApi);

  /**
   * Aba "Interfone": só para o síndico e só com o módulo contratado (interruptor da Prestare no CRM). A API devolve
   * 403 às rotas do síndico quando não contratado; `contratado:false` também esconde.
   */
  readonly interfoneContratado = signal(false);

  // ===================== QR no app =====================

  /**
   * Só o síndico liga e desliga: a API exige typeAccess 'sindico'
   * (assertSindicoEstrito) e não aceita o `turno` texto livre do porteiro.
   * A tela decide pelo mesmo critério para não mostrar um controle que
   * devolveria 403.
   */
  readonly ehSindico = computed(() => {
    this.auth.porteiroInfo(); // recalcula ao entrar / trocar de condomínio
    return papelDoToken(this.auth.token) === 'sindico';
  });

  /** Estado na API; null enquanto carrega ou quando a leitura falhou. */
  readonly qrApp = signal<boolean | null>(null);
  readonly qrAppSalvando = signal(false);
  readonly qrAppErro = signal<string | null>(null);

  /**
   * "Passe na carteira" vem na mesma rota de opção. Só vale com o QR no app
   * ligado: a API recusa ligar sem ele e desliga junto quando o QR desliga.
   */
  readonly wallet = signal<boolean | null>(null);
  readonly walletSalvando = signal(false);
  readonly walletErro = signal<string | null>(null);
  /** O que a chave mostra: desligada sempre que o QR no app está desligado. */
  readonly walletLigado = computed(() => this.qrApp() === true && this.wallet() === true);
  readonly walletBloqueado = computed(
    () => this.qrApp() !== true || this.wallet() === null || this.walletSalvando() || this.qrAppSalvando(),
  );

  ngOnInit() {
    if (this.ehSindico()) {
      this.carregarQrApp();
      this.interfoneApi.config().subscribe({
        next: (c) => this.interfoneContratado.set(!!c?.contratado),
        error: () => this.interfoneContratado.set(false),
      });
    }
  }

  private urlOpcaoQrApp(): string | null {
    const id = this.auth.porteiroInfo()?.id_condominio;
    return id ? `${API_BASE}/credenciais/condominio/${id}/opcao` : null;
  }

  carregarQrApp() {
    const url = this.urlOpcaoQrApp();
    if (!url) return;
    this.qrAppErro.set(null);
    this.http.get<OpcaoCredenciais>(url).subscribe({
      next: (r) => this.aplicarOpcao(r),
      error: () => {
        this.qrApp.set(null);
        this.wallet.set(null);
        this.qrAppErro.set('Não foi possível carregar a opção do QR no app.');
      },
    });
  }

  private aplicarOpcao(r: OpcaoCredenciais | null | undefined) {
    this.qrApp.set(!!r?.qr_app_habilitado);
    this.wallet.set(!!r?.wallet_habilitado);
  }

  /**
   * Ligar muda o acesso físico (o PIN mostrado como QR deixa de abrir), então
   * pede confirmação com o aviso. Desligar volta ao comportamento de antes e
   * vai direto. A chave muda na hora e volta se a API recusar.
   */
  async alternarQrApp() {
    const atual = this.qrApp();
    const url = this.urlOpcaoQrApp();
    if (atual === null || !url || this.qrAppSalvando()) return;
    const novo = !atual;

    if (novo) {
      const ok = await this.confirm.ask({
        title: 'Ligar o QR no app?',
        message: AVISO_QR_APP,
        confirmLabel: 'Ligar',
        variant: 'primary',
      });
      if (!ok) return;
    }

    this.qrAppErro.set(null);
    this.qrAppSalvando.set(true);
    this.qrApp.set(novo);
    this.http.patch<OpcaoCredenciais>(url, { qr_app_habilitado: novo }).subscribe({
      next: (r) => {
        this.qrAppSalvando.set(false);
        this.aplicarOpcao(r);
      },
      error: (err: any) => {
        this.qrAppSalvando.set(false);
        this.qrApp.set(atual);
        this.qrAppErro.set(err?.error?.message || 'Não foi possível alterar o QR no app. Tente de novo.');
      },
    });
  }

  /**
   * Ligar pede confirmação com o aviso (código diário, print vale até o dia
   * seguinte, cancelamento em Moradores). Desligar vai direto. A chave muda na
   * hora e volta se a API recusar.
   */
  async alternarWallet() {
    const atual = this.wallet();
    const url = this.urlOpcaoQrApp();
    if (atual === null || !url || this.walletBloqueado()) return;
    const novo = !atual;

    if (novo) {
      const ok = await this.confirm.ask({
        title: 'Ligar o passe na carteira?',
        message: AVISO_WALLET,
        confirmLabel: 'Ligar',
        variant: 'primary',
      });
      if (!ok) return;
    }

    this.walletErro.set(null);
    this.walletSalvando.set(true);
    this.wallet.set(novo);
    this.http.patch<OpcaoCredenciais>(url, { wallet_habilitado: novo }).subscribe({
      next: (r) => {
        this.walletSalvando.set(false);
        this.aplicarOpcao(r);
      },
      error: (err: any) => {
        this.walletSalvando.set(false);
        this.wallet.set(atual);
        this.walletErro.set(err?.error?.message || 'Não foi possível alterar o passe na carteira. Tente de novo.');
      },
    });
  }

  /** 'equipe' (Equipe da portaria) só aparece e só abre para o síndico (ehSindico, pelo typeAccess do token). */
  readonly currentTab = signal<'conta' | 'terminais' | 'regras' | 'caminho' | 'equipe' | 'interfone'>(
    'conta',
  );

  /** O porteiro abre Configurações só para trocar a própria senha: as outras abas são do síndico. */
  readonly ehPorteiro = computed(() => ehPorteiro(this.auth.porteiroInfo()));
  readonly abaAtual = computed(() => (this.ehPorteiro() ? 'conta' : this.currentTab()));

  // Form State
  senhaAtual = '';
  novaSenha = '';
  confirmarSenha = '';

  // UI States
  readonly mostrarSenhas = signal(false);

  /** Papel real da sessão. Antes: `turno ? 'Portaria' : 'Gestor'` — síndico virava "Portaria". */
  nivelPermissao(turno: string | null | undefined): 'Síndico' | 'Portaria' | 'Gestor' {
    if (!turno) return 'Gestor';
    return turno.trim().toLowerCase() === 'síndico' ? 'Síndico' : 'Portaria';
  }

  /** Checklist ao vivo da nova senha (mesmas regras que alterarSenha() valida). */
  requisitosSenha(): { tamanho: boolean; confere: boolean } {
    return {
      tamanho: this.novaSenha.length >= 6,
      confere: !!this.novaSenha && this.novaSenha === this.confirmarSenha,
    };
  }

  podeSalvarSenha(): boolean {
    const r = this.requisitosSenha();
    return !this.loading() && !!this.senhaAtual && r.tamanho && r.confere;
  }

  readonly loading = signal(false);
  readonly successMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  alterarSenha() {
    this.successMessage.set(null);
    this.errorMessage.set(null);

    if (!this.senhaAtual || !this.novaSenha || !this.confirmarSenha) {
      this.errorMessage.set('Por favor, preencha todos os campos.');
      return;
    }

    if (this.novaSenha !== this.confirmarSenha) {
      this.errorMessage.set('A nova senha e a confirmação não coincidem.');
      return;
    }

    if (this.novaSenha.length < 6) {
      this.errorMessage.set('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    this.loading.set(true);
    this.auth.alterarSenha(this.senhaAtual, this.novaSenha).subscribe({
      next: () => {
        this.loading.set(false);
        this.successMessage.set('Sua senha foi alterada com sucesso!');
        // Limpa formulário
        this.senhaAtual = '';
        this.novaSenha = '';
        this.confirmarSenha = '';
        setTimeout(() => this.successMessage.set(null), 5000);
      },
      error: (err: any) => {
        this.loading.set(false);
        const msg = err?.error?.message || 'Senha atual incorreta ou erro no servidor.';
        this.errorMessage.set(msg);
      }
    });
  }
}
