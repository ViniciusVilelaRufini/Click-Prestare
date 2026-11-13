import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { VisitantesService } from './visitantes.service';
import { AuthService } from '../auth/auth.service';

/**
 * O PIN aparece para o visitante como "123-456". O Dashboard mandava o texto
 * com o hífen e a tela de Visitantes só tirava o PRIMEIRO hífen — "123-456"
 * com espaço ou dois hífens virava "Código inválido".
 */
describe('VisitantesService.validarCodigo — PIN digitado com separador', () => {
  function montar() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }) } },
      ],
    });
    return { svc: TestBed.inject(VisitantesService), http: TestBed.inject(HttpTestingController) };
  }

  it.each([['123-456'], [' 123 456 '], ['12-34-56'], ['123.456']])('"%s" vai como 123456', (digitado) => {
    const { svc, http } = montar();
    svc.validarCodigo(digitado).subscribe();
    const req = http.expectOne((r) => r.url.includes('/visitantes/validar/'));
    expect(req.request.url.endsWith('/visitantes/validar/123456')).toBe(true);
    req.flush({});
  });
});
