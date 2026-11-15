import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GuaritaService, codigoImpressoValido } from './guarita.service';
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
    ['atualizarReceptores', () => api.atualizarReceptores(7), 'POST', `${base}/7/atualizar-receptores`],
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

  it('dispositivos: estado, busca e página vão ao servidor; resposta paginada normalizada', () => {
    let pag: any;
    api.dispositivos(7, { estado: 'a_vincular', busca: ' 101 ', pagina: 2, por_pagina: 50 }).subscribe((p) => (pag = p));
    const req = http.expectOne((r) => r.url === `${base}/7/dispositivos`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('estado')).toBe('a_vincular');
    expect(req.request.params.get('busca')).toBe('101');
    expect(req.request.params.get('pagina')).toBe('2');
    expect(req.request.params.get('por_pagina')).toBe('50');
    req.flush({ itens: [{ id: 30 }, { id_tag: 31 }], total: 812, pagina: 2, por_pagina: 50 });
    expect(pag.itens.map((d: any) => [d.id, d.id_device])).toEqual([[30, 7], [31, 7]]);
    expect([pag.total, pag.pagina, pag.por_pagina]).toEqual([812, 2, 50]);
  });

  it('dispositivos: lista pura (API anterior) vira página única', () => {
    let pag: any;
    api.dispositivos(7).subscribe((p) => (pag = p));
    const req = http.expectOne((r) => r.url === `${base}/7/dispositivos`);
    expect(req.request.params.has('estado')).toBe(false);
    expect(req.request.params.has('busca')).toBe(false);
    req.flush([{ id: 30 }, { id: 31 }, { id: 32 }]);
    expect([pag.itens.length, pag.total, pag.pagina]).toEqual([3, 3, 1]);
  });

  it('veiculosParaVincular: busca e limite 20; aceita morador aninhado', () => {
    let lista: any[] | undefined;
    api.veiculosParaVincular(7, ' ABC ').subscribe((l) => (lista = l));
    const req = http.expectOne((r) => r.url === `${base}/7/veiculos-para-vincular`);
    expect(req.request.params.get('busca')).toBe('ABC');
    expect(req.request.params.get('limite')).toBe('20');
    req.flush([{ id: 1, placa: 'ABC1D23', morador: { nome: 'Ana', apartamento: '101', bloco: 'A' } }]);
    expect(lista).toEqual([{ id: 1, placa: 'ABC1D23', marca_modelo: null, morador_nome: 'Ana', apartamento: '101', bloco: 'A' }]);
  });

  it.each([
    ['vincular', () => api.vincular(7, 30, 101), `${base}/7/dispositivos/30/vincular`, { id_veiculo: 101 }],
    ['aprovar', () => api.aprovar(7, 30), `${base}/7/dispositivos/30/aprovar`, {}],
    ['recusar', () => api.recusar(7, 30), `${base}/7/dispositivos/30/recusar`, {}],
    ['desfazer', () => api.desfazer(7, 30), `${base}/7/dispositivos/30/desfazer`, {}],
    ['regravar', () => api.regravar(7, 30), `${base}/7/dispositivos/30/regravar`, {}],
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

describe('codigoImpressoValido', () => {
  it.each(['015 02158', 'W: 015 02158', '015,02158', '015-02158', '255 65535', '0 0'])('aceita %s', (c) => {
    expect(codigoImpressoValido(c)).toBe(true);
  });
  it.each(['', '12345678', 'E2000017221101441890', '256 00001', '015 65536', 'abc def', '015'])('recusa %s', (c) => {
    expect(codigoImpressoValido(c)).toBe(false);
  });
});

describe('GuaritaService — aprovar com tipo e código', () => {
  it('manda { tipo, codigo_impresso } quando informados', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } }],
    });
    const api = TestBed.inject(GuaritaService);
    const http = TestBed.inject(HttpTestingController);
    api.aprovar(7, 30, { tipo: 2, codigo_impresso: '015 02158' }).subscribe();
    const req = http.expectOne(`${API_BASE}/condominios/3/guarita/7/dispositivos/30/aprovar`);
    expect(req.request.body).toEqual({ tipo: 2, codigo_impresso: '015 02158' });
    req.flush({});
    http.verify();
  });
});
