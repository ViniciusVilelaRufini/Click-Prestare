import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NetworkStatusService } from '../core/network-status.service';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from './api.config';

@Component({
  selector: 'app-network-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Banner de Queda de Rede / Servidor Indisponível -->
    @if (network.hasConnectionIssue()) {
      <aside
        class="sticky top-0 z-[100] w-full px-4 py-2.5 bg-gradient-to-r from-rose-600 to-rose-700 text-white shadow-lg flex items-center justify-between gap-3 text-xs md:text-sm font-medium animate-pulse"
        role="alert"
        aria-live="assertive"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <!-- Ícone Wi-Fi desligado / desconectado -->
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a1 1 0 010-1.414m0 0l2.829-2.829m-2.829 2.829L3 21M3 3l18 18M1.05 10.05a13 13 0 0118.9-1.5" />
            </svg>
          </div>
          <div class="min-w-0">
            <span class="font-bold uppercase tracking-wider block text-[11px] text-rose-100">
              Aviso de Conexão
            </span>
            <p class="truncate">
              {{ network.isOnline() ? 'Sem comunicação com o servidor. A rede caiu ou o sistema está fora do ar.' : 'Computador sem internet. Verifique o cabo de rede ou o Wi-Fi da portaria.' }}
            </p>
          </div>
        </div>

        <button
          type="button"
          (click)="tentarReconectar()"
          [disabled]="verificando()"
          class="shrink-0 px-3 py-1.5 bg-white text-rose-700 hover:bg-rose-50 active:scale-95 transition-all text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
        >
          @if (verificando()) {
            <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Verificando...</span>
          } @else {
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Reconectar</span>
          }
        </button>
      </aside>
    }

    <!-- Banner de Conexão Restabelecida (Feedback positivo temporário) -->
    @if (network.reconnectedRecently() && !network.hasConnectionIssue()) {
      <aside
        class="sticky top-0 z-[100] w-full px-4 py-2 bg-emerald-600 text-white shadow-md flex items-center justify-between gap-3 text-xs font-semibold animate-bounce"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-emerald-100 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Conexão restabelecida! O sistema está online novamente.</span>
        </div>
        <button
          type="button"
          (click)="network.reconnectedRecently.set(false)"
          class="text-white/80 hover:text-white text-base leading-none p-1 cursor-pointer"
          aria-label="Fechar"
        >
          &times;
        </button>
      </aside>
    }
  `,
})
export class NetworkBannerComponent {
  readonly network = inject(NetworkStatusService);
  private readonly http = inject(HttpClient);
  readonly verificando = signal(false);

  tentarReconectar() {
    this.verificando.set(true);
    // Dispara uma chamada leve de ping ao backend
    this.http.get(`${API_BASE}/health`, { responseType: 'text' }).subscribe({
      next: () => {
        this.network.reportHttpSuccess();
        this.verificando.set(false);
      },
      error: (e) => {
        // Se ainda falhar, mantém offline e reavalia
        this.network.reportHttpError(e);
        this.verificando.set(false);
      },
    });
  }
}
