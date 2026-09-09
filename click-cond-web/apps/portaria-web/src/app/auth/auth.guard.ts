import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  if (!auth.isLoggedIn()) {
    inject(Router).navigate(['/login']);
    return false;
  }

  const info = auth.porteiroInfo();
  const isPorter = !!info?.turno && info.turno !== 'Síndico';

  if (isPorter) {
    const path = route.routeConfig?.path || '';
    const url = (state.url || '').toLowerCase();
    const rotasRestritas = ['financeiro', 'relatorios', 'configuracoes'];
    const ehRotaRestrita = rotasRestritas.includes(path) || rotasRestritas.some((r) => url.includes(`/${r}`));

    if (ehRotaRestrita) {
      inject(Router).navigate(['/dashboard']);
      return false;
    }
  }

  return true;
};