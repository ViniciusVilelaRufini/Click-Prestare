import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CentralAuthService } from './central-auth.service';

/**
 * Área Central: só com `central_token` válido (de operador, dentro da validade); senão `/central/login`.
 * O token do porteiro/síndico não abre a central. Com `trocar_senha` entra: a página mostra só a troca
 * de senha até o operador trocar (nenhuma rota da central vale antes disso).
 */
export const centralGuard: CanActivateFn = () => {
  const auth = inject(CentralAuthService);
  if (auth.sessaoValida()) return true;
  return inject(Router).createUrlTree(['/central/login']);
};
