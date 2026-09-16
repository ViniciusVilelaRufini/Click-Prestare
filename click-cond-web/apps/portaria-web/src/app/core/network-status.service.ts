import { Injectable, computed, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  /** Indica se o navegador reporta conexão de rede (Wi-Fi/Cabo) */
  readonly isOnline = signal<boolean>(
    typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true
  );

  /** Indica se o servidor da API está respondendo a requisições */
  readonly isServerReachable = signal<boolean>(true);

  /** Flag temporária indicando que a conexão acabou de voltar (para feedback positivo) */
  readonly reconnectedRecently = signal<boolean>(false);

  /** Há qualquer problema de conexão (sem rede ou servidor fora do ar) */
  readonly hasConnectionIssue = computed<boolean>(
    () => !this.isOnline() || !this.isServerReachable()
  );

  private reconnectTimeoutId: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline.set(true);
        this.notifyReconnected();
      });

      window.addEventListener('offline', () => {
        this.isOnline.set(false);
        this.reconnectedRecently.set(false);
      });
    }
  }

  /** Registra falha HTTP retornada pelas requisições */
  reportHttpError(error: any) {
    if (error instanceof HttpErrorResponse && error.status === 0) {
      this.isServerReachable.set(false);
      this.reconnectedRecently.set(false);
    }
  }

  /** Registra sucesso HTTP para confirmar que o servidor voltou a responder */
  reportHttpSuccess() {
    if (!this.isServerReachable()) {
      this.isServerReachable.set(true);
      this.notifyReconnected();
    }
  }

  /** Força uma tentativa manual de reconexão ou teste de ping */
  notifyReconnected() {
    this.reconnectedRecently.set(true);
    if (this.reconnectTimeoutId) clearTimeout(this.reconnectTimeoutId);
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectedRecently.set(false);
    }, 4000);
  }

  /**
   * Converte erros de API ou de rede em mensagens claras e humanas para o operador da portaria.
   * Elimina completamente o jargão técnico como "Http failure response for ...: 0 undefined".
   */
  getFriendlyErrorMessage(error: any, prefix?: string): string {
    let base = '';

    // 1. Sem conexão do navegador (navegador explicitamente offline)
    if (!this.isOnline()) {
      base = 'Sem conexão com a internet. Verifique o cabo de rede ou o Wi-Fi da portaria.';
    }
    // 2. Erro de status 0 (servidor inacessível, queda de rede pontual ou CORS/Timeout)
    else if (
      (error instanceof HttpErrorResponse && error.status === 0) ||
      error?.status === 0 ||
      (typeof error?.message === 'string' && error.message.includes(': 0 '))
    ) {
      base = 'Sem conexão com o servidor. A rede caiu ou o sistema está fora do ar. Verifique a internet e tente novamente.';
    }
    // 3. Mensagem de regra de negócio enviada pelo backend (ex: 400, 403, 422)
    else if (error?.error?.message) {
      base = Array.isArray(error.error.message)
        ? error.error.message.join(', ')
        : String(error.error.message);
    }
    // 4. Timeout no gateway (504)
    else if (error?.status === 504) {
      base = 'Tempo limite esgotado. O servidor demorou muito para responder. Tente novamente.';
    }
    // 5. Servidor indisponível / reiniciando (502 / 503)
    else if (error?.status === 502 || error?.status === 503) {
      base = 'Servidor temporariamente indisponível para atualização. Tente novamente em instantes.';
    }
    // 6. Sessão expirada (401)
    else if (error?.status === 401) {
      base = 'Sua sessão expirou. Faça login novamente.';
    }
    // 7. Mensagem padrão se houver string limpa
    else if (typeof error === 'string') {
      base = error.includes('Http failure')
        ? 'Falha de comunicação com o servidor. Verifique a conexão de rede.'
        : error;
    } else if (error?.message && !error.message.includes('Http failure')) {
      base = error.message;
    } else {
      base = 'Não foi possível completar a operação. Verifique sua conexão e tente novamente.';
    }

    return prefix ? `${prefix}: ${base}` : base;
  }
}
