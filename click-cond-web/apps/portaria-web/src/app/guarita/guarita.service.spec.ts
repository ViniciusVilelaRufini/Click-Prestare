import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GuaritaService } from './guarita.service';
import { AuthService } from '../auth/auth.service';
import { API_BASE } from '../shared/api.config';

/**
 * Rotas que o console assume para o Módulo Guarita (Tasks B2–B6 do plano).
 * Este arquivo é o contrato do lado do console: o lado da API tem de casar com ele.
 */
describe('GuaritaService — rotas do console', () => {
  let api: GuaritaService;
  let http: HttpTestingController;
  const base = `${API_BASE}/condominios/3/guarita`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
      ],
    });
    api = TestBed.inject(GuaritaService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('listarGuaritas lê a lista de aparelhos e fica só com os guaritas ativos', () => {
    let lista: any[] | undefined;
    api.listarGuaritas().subscribe((l) => (lista = l));
    const req = http.expectOne((r) => r.url === `${API_BASE}/facial/devices`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('id_condominio')).toBe('3');
    req.flush([
      { id: 1, tipo: 'facial', ativo: 1 },
      { id: 2, tipo: 'guarita', ativo: 1 },
      { id: 3, tipo: 'guarita', ativo: 0 },
    ]);
    expect(lista?.map((d) => d.id)).toEqual([2]);
  });

  it('listarGuaritas: falha na consulta vira lista vazia (tela de sempre, sem erro)', () => {
    let lista: any[] | undefined;
    let erro: unknown;
    api.listarGuaritas().subscribe({ next: (l) => (lista = l), error: (e) => (erro = e) });
    http.expectOne((r) => r.url === `${API_BASE}/facial/devices`).flush('x', { status: 500, statusText: 'erro' });
    expect(erro).toBeUndefined();
    expect(lista).toEqual([]);
  });

  it.each([
    ['estado', () => api.estado(7), 'GET', `${base}/7/estado`],
    ['importar', () => api.importar(7), 'POST', `${base}/7/importar`],
    ['conferir', () => api.conferir(7), 'POST', `${base}/7/conferir`],
    ['operacao', () => api.operacao(7, 55), 'GET', `${base}/7/operacoes/55`],
    ['backups', () => api.backups(7), 'GET', `${base}/7/backups`],
    ['portoes', () => api.portoes(7), 'GET', `${base}/7/portoes`],
    ['removerPortao', () => api.removerPortao(7, 4), 'DELETE', `${base}/7/portoes/4`],
  ] as const)('%s → %s %s', (_nome, chamar, metodo, url) => {
    (chamar as () => any)().subscribe();
    const req = http.expectOne(url);
    expect(req.request.method).toBe(metodo);
    req.flush({});
  });

  it('baixarBackup pede o JSON como arquivo', () => {
    api.baixarBackup(7, 9).subscribe();
    const req = http.expectOne(`${base}/7/backups/9`);
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['[]']));
  });

  it('criarPortao e atualizarPortao mandam o portão inteiro', () => {
    const dto = { nome: 'Garagem entrada', tipo_receptor: 1, num_receptor: 2, botao: 1, rele: 3, sentido: 'entrada' };
    api.criarPortao(7, dto).subscribe();
    const c = http.expectOne(`${base}/7/portoes`);
    expect(c.request.method).toBe('POST');
    expect(c.request.body).toEqual(dto);
    c.flush({ id: 1, ...dto });
    api.atualizarPortao(7, 1, dto).subscribe();
    const u = http.expectOne(`${base}/7/portoes/1`);
    expect(u.request.method).toBe('PUT');
    expect(u.request.body).toEqual(dto);
    u.flush({ id: 1, ...dto });
  });
});
