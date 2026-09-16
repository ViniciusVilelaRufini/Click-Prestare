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
    <!-- Banner Flutuante de Queda de Rede / Servidor Indisponível (Design Glassmorphism Moderno) -->
    @if (network.hasConnectionIssue()) {
      <div
        class="fixed top-3 sm:top-4 left-1/2 -translate-x-1/2 z-[150] w-[calc(100%-2rem)] max-w-2xl transition-all duration-300 pointer-events-auto"
        role="alert"
        aria-live="assertive"
      >
        <div
          class="relative overflow-hidden rounded-2xl bg-slate-900/95 dark:bg-black/90 backdrop-blur-xl border border-rose-500/40 p-3 sm:p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_25px_rgba(244,63,94,0.18)] flex items-center justify-between gap-3 text-white"
        >
          <!-- Linha de gradiente luminosa no topo do card -->
          <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-rose-400 to-transparent"></div>

          <!-- Informações de status à esquerda -->
          <div class="flex items-center gap-3 min-w-0">
            <div class="relative w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0 text-rose-400 shadow-inner">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 4.243a1 1 0 010-1.414m0 0l2.829-2.829m-2.829 2.829L3 21M3 3l18 18M1.05 10.05a13 13 0 0118.9-1.5" />
              </svg>
            </div>
            
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="relative flex h-2 w-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
                <span class="text-[11px] font-extrabold tracking-wider uppercase text-rose-400">
                  {{ network.isOnline() ? 'Sem Sinal do Servidor' : 'Sem Conexão com a Internet' }}
                </span>
              </div>
              <p class="text-xs sm:text-sm text-slate-200 font-medium leading-tight mt-0.5 truncate">
                {{ network.isOnline() ? 'A rede caiu ou o sistema está fora do ar. Verifique a internet da portaria.' : 'Cabo de rede desconectado ou sem sinal Wi-Fi.' }}
              </p>
            </div>
          </div>

          <!-- Botão Reconectar estilizado -->
          <button
            type="button"
            (click)="tentarReconectar()"
            [disabled]="verificando()"
            class="shrink-0 px-3.5 py-2 bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-600 active:scale-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-600/30 transition-all flex items-center gap-1.5 cursor-pointer border border-rose-400/30 disabled:opacity-50"
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
          class="relative overflow-hidden rounded-2xl bg-slate-900/95 dark:bg-black/90 backdrop-blur-xl border border-emerald-500/40 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_25px_rgba(16,185,129,0.2)] flex items-center justify-between gap-3 text-white"
        >
          <div class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400 to-transparent"></div>
          
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0 text-emerald-400 shadow-inner">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div class="min-w-0">
              <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block">
                Conexão Restabelecida
              </span>
              <p class="text-xs text-slate-200 font-medium truncate">
                O sistema da portaria está online novamente.
              </p>
            </div>
          </div>

          <button
            type="button"
            (click)="network.reconnectedRecently.set(false)"
            class="text-slate-400 hover:text-white text-lg leading-none p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
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
