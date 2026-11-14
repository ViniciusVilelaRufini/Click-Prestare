import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../auth/auth.service';
import { papelDoToken } from '../auth/papel';
import { ConfirmService } from '../shared/confirm.service';
import { API_BASE } from '../shared/api.config';
import { TerminaisFaciaisPageComponent } from '../terminais-faciais/terminais-faciais-page.component';
import { RegrasAcessoComponent } from './regras-acesso/regras-acesso.component';
import { CaminhoLeitoresComponent } from './caminho-leitores/caminho-leitores.component';

import { SlideIndicatorDirective } from '../shared/slide-indicator.directive';

/** Aviso mostrado antes de ligar o QR no app (texto do plano, sem variação). */
export const AVISO_QR_APP =
  'O QR depende da internet do condomínio. Antes de ligar, confirme que todo morador sem rosto cadastrado tem tag ou que há porteiro. Com a opção ligada, o PIN do visitante deixa de abrir quando mostrado como QR no leitor; continua valendo digitado na portaria.';

@Component({
  selector: 'app-configuracoes-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TerminaisFaciaisPageComponent,
    RegrasAcessoComponent,
    CaminhoLeitoresComponent,
    SlideIndicatorDirective,
  ],
  templateUrl: './configuracoes-page.component.html',
})
export class ConfiguracoesPageComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly confirm = inject(ConfirmService);

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

  ngOnInit() {
    if (this.ehSindico()) this.carregarQrApp();
  }

  private urlOpcaoQrApp(): string | null {
    const id = this.auth.porteiroInfo()?.id_condominio;
    return id ? `${API_BASE}/credenciais/condominio/${id}/opcao` : null;
  }

  carregarQrApp() {
    const url = this.urlOpcaoQrApp();
    if (!url) return;
    this.qrAppErro.set(null);
    this.http.get<{ qr_app_habilitado: boolean }>(url).subscribe({
      next: (r) => this.qrApp.set(!!r?.qr_app_habilitado),
      error: () => {
        this.qrApp.set(null);
        this.qrAppErro.set('Não foi possível carregar a opção do QR no app.');
      },
    });
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
    this.http.patch<{ qr_app_habilitado: boolean }>(url, { qr_app_habilitado: novo }).subscribe({
      next: (r) => {
        this.qrAppSalvando.set(false);
        this.qrApp.set(!!r?.qr_app_habilitado);
      },
      error: (err: any) => {
        this.qrAppSalvando.set(false);
        this.qrApp.set(atual);
        this.qrAppErro.set(err?.error?.message || 'Não foi possível alterar o QR no app. Tente de novo.');
      },
    });
  }

  readonly currentTab = signal<'conta' | 'terminais' | 'regras' | 'caminho'>(
    'conta',
  );

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
