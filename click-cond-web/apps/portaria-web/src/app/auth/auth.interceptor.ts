import {
  HttpInterceptorFn,
  HttpErrorResponse,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { ServerClockService } from '../core/server-clock.service';
import { NetworkStatusService } from '../core/network-status.service';
import { catchError, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { shouldDirectToApi } from '../shared/api.config';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const clock = inject(ServerClockService);
  const network = inject(NetworkStatusService);
  const token = auth.token;
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }

  // Em produção, direciona chamadas /api diretamente para api.clickprestarecondominios.com.br
  // contornando o proxy reverso do Amplify para preservar o IP real do cliente.
  if (shouldDirectToApi() && req.url.startsWith('/api')) {
    req = req.clone({
      url: `https://api.clickprestarecondominios.com.br${req.url}`,
    });
  }

  const enviadoEm = Date.now();
  return next(req).pipe(
    // Toda resposta carrega o header `Date` do servidor — de graça, mede o
    // quanto o relógio DESTA máquina está errado. Ver ServerClockService.
    tap((ev) => {
      if (ev instanceof HttpResponse) {
        clock.registrar(ev.headers.get('Date'), enviadoEm);
        network.reportHttpSuccess();
      }
    }),
    catchError((error: HttpErrorResponse) => {
      // A resposta de erro também traz o header, e é justamente quando a rede
      // está ruim que o relógio importa. Aproveita antes de repassar.
      clock.registrar(error.headers?.get('Date') ?? null, enviadoEm);
      if (error.status === 401) {
        auth.logout();
      }

      // Notifica o serviço de status de rede em caso de status 0 (queda de conexão)
      network.reportHttpError(error);

      // Normaliza mensagens técnicas do Angular (ex: "Http failure response ...: 0 undefined")
      // para um texto em português claro e direto para o operador da portaria.
      const friendlyMsg = network.getFriendlyErrorMessage(error);
      try {
        Object.defineProperty(error, 'message', {
          value: friendlyMsg,
          writable: true,
          configurable: true,
        });
        if (!error.error || typeof error.error !== 'object') {
          (error as any).error = { message: friendlyMsg };
        } else if (!error.error.message) {
          error.error.message = friendlyMsg;
        }
      } catch {
        // Ignora caso o objeto de erro seja congelado pelo runtime
      }

      return throwError(() => error);
    })
  );
};