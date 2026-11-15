import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AssembleiasApi } from './assembleias.service';
import { AuthService } from '../auth/auth.service';

/**
 * Rodada 5: finalizar não apaga mais. O console pede a lista com as
 * finalizadas (a API antiga ignora o parâmetro) e o mapa de votação nominal.
 */
describe('AssembleiasApi — rodada 5', () => {
  function montar() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 5 }) } },
      ],
    });
    return { svc: TestBed.inject(AssembleiasApi), http: TestBed.inject(HttpTestingController) };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('lista de assembleias pede as finalizadas também', () => {
    const { svc, http } = montar();
    svc.listAssembleias().subscribe();
    const req = http.expectOne((r) => r.url.includes('/assembleias/get-all'));
    expect(req.request.url).toContain('id_condominio=5');
    expect(req.request.url).toContain('incluir_finalizadas=1');
    req.flush([]);
    http.verify();
  });
});
