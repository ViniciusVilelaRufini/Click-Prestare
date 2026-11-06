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
    <!-- Aviso de queda de rede / servidor indisponível -->
    @if (network.hasConnectionIssue()) {
      <div
        class="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-2xl pointer-events-auto"
        role="alert"
        aria-live="assertive"
      >
        <div class="bg-[var(--bg-100)] border border-[var(--line-200)] p-3 sm:p-4 flex items-center justify-between gap-3.5">
          <div class="flex items-center gap-3 min-w-0">
            <svg class="w-5 h-5 shrink-0" style="color: var(--signal-danger)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h.01" />
              <path d="M8.5 16.429a5 5 0 0 1 7 0" />
              <path d="M5 12.857a10 10 0 0 1 5.107-2.717" />
              <path d="M19 12.857a10 10 0 0 0-2.3-1.5" />
              <path d="M1.4 9.286a15 15 0 0 1 4.7-2.88" />
              <path d="M10.7 5.05A15 15 0 0 1 22.6 9.286" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="ps-dot ps-dot-danger ps-dot-pulse"></span>
                <span class="ps-label" style="color: var(--signal-danger)">
                  {{ network.isOnline() ? 'Sem Sinal do Servidor' : 'Sem Conexão com a Internet' }}
                </span>
              </div>
              <p class="text-xs sm:text-sm leading-snug mt-1" style="color: var(--ink-muted)">
                {{ network.isOnline() ? 'A rede caiu ou o sistema está fora do ar. Verifique a internet da portaria.' : 'Cabo de rede desconectado ou sem sinal Wi-Fi.' }}
              </p>
            </div>
          </div>

          <button type="button" (click)="tentarReconectar()" [disabled]="verificando()"
                  class="ps-btn ps-btn-sm shrink-0 disabled:opacity-50">
            @if (verificando()) {
              <svg class="animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Testando...</span>
            } @else {
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Reconectar</span>
            }
          </button>
        </div>
      </div>
    }

    <!-- Conexão restabelecida -->
    @if (network.reconnectedRecently() && !network.hasConnectionIssue()) {
      <div
        class="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-lg pointer-events-auto"
        role="status"
        aria-live="polite"
      >
        <div class="bg-[var(--bg-100)] border border-[var(--line-200)] p-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="ps-dot ps-dot-ok"></span>
            <div class="min-w-0">
              <span class="ps-label block" style="color: var(--signal-ok)">Conexão Restabelecida</span>
              <p class="text-xs mt-1" style="color: var(--ink-muted)">O sistema da portaria está online novamente.</p>
            </div>
          </div>
          <button type="button" (click)="network.reconnectedRecently.set(false)" class="ps-ibtn" aria-label="Fechar">
            &times;
          </button>
        </div>
      </div>
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
