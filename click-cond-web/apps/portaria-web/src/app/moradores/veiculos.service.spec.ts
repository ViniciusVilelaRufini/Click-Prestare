import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { VeiculosApi } from './veiculos.service';
import { AuthService } from '../auth/auth.service';
import { API_BASE } from '../shared/api.config';

/** Contrato das rotas de tag (apps/api/src/app/veiculos/tags.controller.ts). */
describe('VeiculosApi — tags', () => {
  let api: VeiculosApi;
  let http: HttpTestingController;
  const base = `${API_BASE}/condominios/3/tags`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
      ],
    });
    api = TestBed.inject(VeiculosApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('listTags() sem argumentos não manda filtros (só ativas)', () => {
    api.listTags().subscribe();
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('listTags(true) pede só as livres', () => {
    api.listTags(true).subscribe();
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('livres')).toBe('true');
    expect(req.request.params.has('inativas')).toBe(false);
    req.flush([]);
  });

  it('listTags(false, true) inclui as bloqueadas', () => {
    api.listTags(false, true).subscribe();
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.get('inativas')).toBe('true');
    expect(req.request.params.has('livres')).toBe(false);
    req.flush([]);
  });

  it('setTagAtivo faz PATCH com { ativo }', () => {
    api.setTagAtivo(7, false).subscribe();
    const req = http.expectOne(`${base}/7`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ ativo: false });
    req.flush({});
  });

  it('removeTag faz DELETE', () => {
    api.removeTag(7).subscribe();
    const req = http.expectOne(`${base}/7`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true });
  });
});
