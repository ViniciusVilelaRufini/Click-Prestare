import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { ehPorteiro, ROTAS_SO_SINDICO } from './papel';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  if (!auth.isLoggedIn()) {
    inject(Router).navigate(['/login']);
    return false;
  }

  if (ehPorteiro(auth.porteiroInfo())) {
    const path = route.routeConfig?.path || '';
    const url = (state.url || '').toLowerCase();
    const ehRotaRestrita = ROTAS_SO_SINDICO.includes(path) || ROTAS_SO_SINDICO.some((r) => url.includes(`/${r}`));

    if (ehRotaRestrita) {
      inject(Router).navigate(['/dashboard']);
      return false;
    }
  }

  return true;
};