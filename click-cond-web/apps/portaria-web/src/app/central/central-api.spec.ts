import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CentralApi } from './central-api';
import { CentralAuthService } from './central-auth.service';

describe('CentralApi', () => {
  let api: CentralApi;
  let http: HttpTestingController;
  const auth = { token: 'tok-central' as string | null, logout: jest.fn(), marcarTrocarSenha: jest.fn() };
  const router = { navigateByUrl: jest.fn() };

  beforeEach(() => {
    auth.logout.mockReset();
    auth.marcarTrocarSenha.mockReset();
    router.navigateByUrl.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CentralAuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });
    api = TestBed.inject(CentralApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('manda o central_token no Authorization', () => {
    api.fila().subscribe();
    const req = http.expectOne('/api/central/fila');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-central');
    req.flush([]);
  });

  it('rotas e corpos do contrato', () => {
    api.abrir(41, 'outro', 'Técnico').subscribe();
    expect(http.expectOne('/api/central/chamadas/41/abrir').request.body).toEqual({ codigo: 'outro', detalhe: 'Técnico' });
    api.abrir(41, 'entrega').subscribe();
    expect(http.expectOne('/api/central/chamadas/41/abrir').request.body).toEqual({ codigo: 'entrega' });
    api.pedido(41, { nome: 'Zé', tipo: 'entrega', id_apartamento: 100 }).subscribe();
    expect(http.expectOne('/api/central/chamadas/41/pedido').request.body).toEqual({ nome: 'Zé', tipo: 'entrega', id_apartamento: 100 });
    api.ligar(100).subscribe();
    expect(http.expectOne('/api/central/ligar').request.body).toEqual({ id_apartamento: 100 });
    api.unidades(1, 'a 10').subscribe();
    expect(http.expectOne((r) => r.url === '/api/central/condominios/1/unidades').request.params.get('busca')).toBe('a 10');
    api.historico('2026-11-28').subscribe();
    expect(http.expectOne((r) => r.url === '/api/central/historico').request.params.get('data')).toBe('2026-11-28');
    api.alertas(true).subscribe();
    expect(http.expectOne((r) => r.url === '/api/central/alertas').request.params.get('pendentes')).toBe('1');
    api.alertaVisto(7).subscribe();
    http.expectOne('/api/central/alertas/7/visto');
  });

  it('401: sessão da central acabou — sai e volta para o login', async () => {
    const p = firstValueFrom(api.fila()).catch((e) => e);
    http.expectOne('/api/central/fila').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect((await p).status).toBe(401);
    expect(auth.logout).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/central/login');
  });

  it('403 trocar_senha: marca o operador para trocar a senha', async () => {
    const p = firstValueFrom(api.fila()).catch((e) => e);
    http.expectOne('/api/central/fila').flush({ motivo: 'trocar_senha' }, { status: 403, statusText: 'Forbidden' });
    await p;
    expect(auth.marcarTrocarSenha).toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
