import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MoradoresApi } from './moradores.service';
import { ConsentimentosApi } from '../core/consentimentos.service';
import { AuthService } from '../auth/auth.service';
import { API_BASE } from '../shared/api.config';

/**
 * "Revogar Biometria": a rota da API é
 * POST condominios/:id/consentimentos/moradores/:idMorador/revogar-biometria
 * (apps/api/src/app/consentimentos/consentimentos.controller.ts). O caminho
 * antigo (condominios/:id/moradores/:id/revogar-biometria) não existe e dava 404.
 */
describe('revogar biometria do morador — rota', () => {
  let http: HttpTestingController;
  const esperado = `${API_BASE}/condominios/3/consentimentos/moradores/42/revogar-biometria`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('MoradoresApi.revogarBiometria faz POST na rota de consentimentos', () => {
    TestBed.inject(MoradoresApi).revogarBiometria(42).subscribe();
    const req = http.expectOne(esperado);
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true });
  });

  it('ConsentimentosApi.revogarBiometriaMorador usa a mesma rota', () => {
    TestBed.inject(ConsentimentosApi).revogarBiometriaMorador(42).subscribe();
    const req = http.expectOne(esperado);
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true });
  });
});
