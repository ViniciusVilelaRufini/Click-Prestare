import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../auth/auth.service';
import { TerminaisFaciaisPageComponent } from '../terminais-faciais/terminais-faciais-page.component';
import { SimuladorDispositivosComponent } from './simulador-dispositivos/simulador-dispositivos.component';
import { RegrasAcessoComponent } from './regras-acesso/regras-acesso.component';

@Component({
  selector: 'app-configuracoes-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TerminaisFaciaisPageComponent,
    SimuladorDispositivosComponent,
    RegrasAcessoComponent,
  ],
  templateUrl: './configuracoes-page.component.html',
})
export class ConfiguracoesPageComponent {
  readonly auth = inject(AuthService);

  readonly currentTab = signal<'conta' | 'terminais' | 'simulador' | 'regras'>('conta');

  // Form State
  senhaAtual = '';
  novaSenha = '';
  confirmarSenha = '';

  // UI States
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
