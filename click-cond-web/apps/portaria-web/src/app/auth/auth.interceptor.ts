import {
  HttpInterceptorFn,
  HttpErrorResponse,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { ServerClockService } from '../core/server-clock.service';
import { catchError, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const clock = inject(ServerClockService);
  const token = auth.token;
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  const enviadoEm = Date.now();
  return next(req).pipe(
    // Toda resposta carrega o header `Date` do servidor — de graça, mede o
    // quanto o relógio DESTA máquina está errado. Ver ServerClockService.
    tap((ev) => {
      if (ev instanceof HttpResponse) {
        clock.registrar(ev.headers.get('Date'), enviadoEm);
      }
    }),
    catchError((error: HttpErrorResponse) => {
      // A resposta de erro também traz o header, e é justamente quando a rede
      // está ruim que o relógio importa. Aproveita antes de repassar.
      clock.registrar(error.headers?.get('Date') ?? null, enviadoEm);
      if (error.status === 401) {
        auth.logout();
      }
      return throwError(() => error);
    })
  );
};