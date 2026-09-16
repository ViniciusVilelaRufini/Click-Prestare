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
    <!-- Banner Flutuante de Queda de Rede / Servidor Indisponível (Design Glassmorphism Harmonioso) -->
    @if (network.hasConnectionIssue()) {
      <div
        class="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-2xl transition-all duration-300 pointer-events-auto"
        role="alert"
        aria-live="assertive"
      >
        <div
          class="relative overflow-hidden rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-rose-200/90 dark:border-rose-500/30 p-3 sm:p-4 shadow-[0_10px_25px_-5px_rgba(225,29,72,0.14),0_8px_16px_-6px_rgba(15,23,42,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_25px_rgba(244,63,94,0.18)] flex items-center justify-between gap-3.5"
        >
          <!-- Linha de gradiente luminosa no topo do card -->
          <div class="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-rose-500/60 dark:via-rose-400 to-transparent"></div>

          <!-- Informações de status à esquerda -->
          <div class="flex items-center gap-3 min-w-0">
            <div class="relative w-10 h-10 rounded-xl bg-rose-50 border border-rose-200/90 text-rose-600 dark:bg-rose-500/15 dark:border-rose-500/30 dark:text-rose-400 flex items-center justify-center shrink-0 shadow-sm">
              <!-- Ícone Oficial Wi-Fi Desconectado (Nítido e Limpo) -->
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h.01" />
                <path d="M8.5 16.429a5 5 0 0 1 7 0" />
                <path d="M5 12.857a10 10 0 0 1 5.107-2.717" />
                <path d="M19 12.857a10 10 0 0 0-2.3-1.5" />
                <path d="M1.4 9.286a15 15 0 0 1 4.7-2.88" />
                <path d="M10.7 5.05A15 15 0 0 1 22.6 9.286" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            </div>
            
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="relative flex h-2 w-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-rose-600 dark:bg-rose-500"></span>
                </span>
                <span class="text-[11px] font-extrabold tracking-wider uppercase text-rose-600 dark:text-rose-400">
                  {{ network.isOnline() ? 'Sem Sinal do Servidor' : 'Sem Conexão com a Internet' }}
                </span>
              </div>
              <p class="text-xs sm:text-sm text-slate-600 dark:text-slate-300 font-medium leading-snug mt-0.5">
                {{ network.isOnline() ? 'A rede caiu ou o sistema está fora do ar. Verifique a internet da portaria.' : 'Cabo de rede desconectado ou sem sinal Wi-Fi.' }}
              </p>
            </div>
          </div>

          <!-- Botão Reconectar estilizado -->
          <button
            type="button"
            (click)="tentarReconectar()"
            [disabled]="verificando()"
            class="shrink-0 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-sm hover:shadow active:shadow-none transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 dark:bg-gradient-to-r dark:from-rose-600 dark:to-rose-500 dark:shadow-lg dark:shadow-rose-600/30 dark:border dark:border-rose-400/30"
          >
            @if (verificando()) {
              <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Testando...</span>
            } @else {
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Reconectar</span>
            }
          </button>
        </div>
      </div>
    }

    <!-- Banner Flutuante de Conexão Restabelecida -->
    @if (network.reconnectedRecently() && !network.hasConnectionIssue()) {
      <div
        class="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-lg transition-all duration-300 pointer-events-auto"
        role="status"
        aria-live="polite"
      >
        <div
          class="relative overflow-hidden rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-emerald-200/90 dark:border-emerald-500/40 p-3 shadow-[0_10px_25px_-5px_rgba(16,185,129,0.15),0_8px_16px_-6px_rgba(15,23,42,0.06)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_25px_rgba(16,185,129,0.2)] flex items-center justify-between gap-3"
        >
          <div class="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/60 dark:via-emerald-400 to-transparent"></div>
          
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-400 flex items-center justify-center shrink-0 shadow-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div class="min-w-0">
              <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                Conexão Restabelecida
              </span>
              <p class="text-xs text-slate-600 dark:text-slate-300 font-medium">
                O sistema da portaria está online novamente.
              </p>
            </div>
          </div>

          <button
            type="button"
            (click)="network.reconnectedRecently.set(false)"
            class="text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg leading-none p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
            aria-label="Fechar"
          >
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
