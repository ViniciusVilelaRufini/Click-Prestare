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

  it('dispositivos: filtro por estado e id da tag normalizado (id ou id_tag)', () => {
    let lista: any[] | undefined;
    api.dispositivos(7, 'a_vincular').subscribe((l) => (lista = l));
    const req = http.expectOne((r) => r.url === `${base}/7/dispositivos`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('estado')).toBe('a_vincular');
    req.flush([{ id: 30, guarita_estado: 'a_vincular' }, { id_tag: 31, guarita_estado: 'a_vincular' }]);
    expect(lista?.map((d) => [d.id, d.id_device])).toEqual([[30, 7], [31, 7]]);
    api.dispositivos(7).subscribe();
    expect(http.expectOne((r) => r.url === `${base}/7/dispositivos`).request.params.has('estado')).toBe(false);
  });

  it.each([
    ['vincular', () => api.vincular(7, 30, 101), `${base}/7/dispositivos/30/vincular`, { id_veiculo: 101 }],
    ['aprovar', () => api.aprovar(7, 30), `${base}/7/dispositivos/30/aprovar`, {}],
    ['recusar', () => api.recusar(7, 30), `${base}/7/dispositivos/30/recusar`, {}],
    ['abrirCaptura', () => api.abrirCaptura(7, 101), `${base}/7/captura`, { id_veiculo: 101 }],
    [
      'confirmarCaptura',
      () => api.confirmarCaptura(7, { tipo: 1, serial_hex: '1A2B3C4', id_veiculo: 101 }),
      `${base}/7/captura/confirmar`,
      { tipo: 1, serial_hex: '1A2B3C4', id_veiculo: 101 },
    ],
    [
      'cadastrarPorCodigo',
      () => api.cadastrarPorCodigo(7, { id_veiculo: 101, tipo: 3, codigo_impresso: '015 02158' }),
      `${base}/7/dispositivos`,
      { id_veiculo: 101, tipo: 3, codigo_impresso: '015 02158' },
    ],
  ] as const)('%s → POST %s', (_nome, chamar, url, corpo) => {
    (chamar as () => any)().subscribe();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(corpo);
    req.flush({});
  });

  it('lerCaptura aceita a lista pura ou { recebidos }', () => {
    const item = { tipo: 2, serial_hex: '0F086E', tem_contador: false, recebido_em: '2026-11-15T12:00:00Z' };
    let a: any[] | undefined;
    let b: any[] | undefined;
    api.lerCaptura(7).subscribe((l) => (a = l));
    http.expectOne(`${base}/7/captura`).flush([item]);
    api.lerCaptura(7).subscribe((l) => (b = l));
    http.expectOne(`${base}/7/captura`).flush({ recebidos: [item, { lixo: true }] });
    expect(a).toEqual([item]);
    expect(b).toEqual([item]);
  });

  it('abrirPortao → POST …/portoes/:id/abrir', () => {
    api.abrirPortao(7, 1).subscribe();
    const req = http.expectOne(`${base}/7/portoes/1/abrir`);
    expect(req.request.method).toBe('POST');
    req.flush({ enviado: true });
  });

  it('alertas pendentes (de todos os Guaritas) e marcar como visto', () => {
    api.alertas(true).subscribe();
    const a = http.expectOne((r) => r.url === `${base}/alertas`);
    expect(a.request.method).toBe('GET');
    expect(a.request.params.get('pendentes')).toBe('1');
    a.flush([]);
    api.marcarAlertaVisto(90).subscribe();
    const v = http.expectOne(`${base}/alertas/90/visto`);
    expect(v.request.method).toBe('POST');
    v.flush({});
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
