import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('authGuard — rotas restritas ao síndico', () => {
  const navigate = jest.fn();

  function executar(info: { turno: string | null } | null, path: string, url = `/${path}`) {
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: AuthService, useValue: { isLoggedIn: () => !!info, porteiroInfo: () => info } },
      ],
    });
    return TestBed.runInInjectionContext(() =>
      authGuard({ routeConfig: { path } } as any, { url } as any),
    );
  }

  beforeEach(() => navigate.mockReset());

  it.each(['configuracoes', 'terminais-faciais', 'financeiro', 'relatorios'])(
    'porteiro é redirecionado para /dashboard em /%s',
    (rota) => {
      expect(executar({ turno: 'Diurno' }, rota)).toBe(false);
      expect(navigate).toHaveBeenCalledWith(['/dashboard']);
    },
  );

  it('porteiro do app (QR) também é barrado', () => {
    expect(executar({ turno: 'Porteiro (App)' }, 'terminais-faciais')).toBe(false);
  });

  it.each(['configuracoes', 'terminais-faciais', 'financeiro', 'relatorios'])(
    'síndico entra em /%s',
    (rota) => {
      expect(executar({ turno: 'Síndico' }, rota)).toBe(true);
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('porteiro continua entrando nas telas operacionais', () => {
    expect(executar({ turno: 'Diurno' }, 'visitantes')).toBe(true);
  });

  it('sem sessão manda para o login', () => {
    expect(executar(null, 'dashboard')).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });
});
