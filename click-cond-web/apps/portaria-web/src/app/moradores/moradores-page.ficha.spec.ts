import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MoradoresPageComponent } from './moradores-page.component';
import { MoradoresApi } from './moradores.service';
import { VeiculosApi } from './veiculos.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { ToastService } from '../shared/toast.service';
import { API_BASE } from '../shared/api.config';

/**
 * Rodada 4, item 2: a lista não traz mais tag RFID nem QR Code. A edição e o painel de detalhes
 * leem os dois da ficha (GET :id); a edição só os envia quando o operador os altera.
 */

describe('MoradoresApi.get', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('busca a ficha do morador', () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    let r: any;
    TestBed.inject(MoradoresApi).get(42).subscribe((v) => (r = v));
    const req = http.expectOne(`${API_BASE}/condominios/3/moradores/42`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 42, tag_rfid: 'T1' });
    expect(r).toEqual({ id: 42, tag_rfid: 'T1' });
    http.verify();
  });
});

describe('MoradoresPageComponent — formulário e detalhes pela ficha', () => {
  afterEach(() => TestBed.resetTestingModule());

  const daLista = {
    id: 5, nome: 'Bia Souza', email: null, documento: null, telefone: null, data_nascimento: null,
    tipo: 'proprietario', bloco: 'A', apartamento: '101', id_apartamento: 7, id_condominio: 1,
    photo: null, foto_pessoa: null, foto_documento: null, tem_conta_app: false,
  } as any;
  const ficha = { ...daLista, tag_rfid: '0001234567', qrcode_acesso: 'QR-9', user: { photo: null } };

  function build(get: jest.Mock) {
    const toast = { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() };
    const api = {
      list: jest.fn(() => of([])),
      get,
      update: jest.fn(() => of(ficha)),
      atividade: jest.fn(() => of({ visitas: [], encomendas: [], ocorrencias: [], acessos: [], stats: {} })),
    };
    TestBed.configureTestingModule({
      imports: [MoradoresPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MoradoresApi, useValue: api },
        { provide: VeiculosApi, useValue: { listByMorador: jest.fn(() => of([])), listTags: jest.fn(() => of([])) } },
        { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(() => Promise.resolve(true)) } },
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }), token: '' } },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    });
    const fixture = TestBed.createComponent(MoradoresPageComponent);
    return { fixture, tela: fixture.componentInstance, api, toast };
  }

  it('editar carrega a ficha e o formulário mostra a tag e o QR dela', () => {
    const { tela, api } = build(jest.fn(() => of(ficha)));
    tela.abrirEditar(daLista);
    expect(api.get).toHaveBeenCalledWith(5);
    expect(tela.showForm).toBe(true);
    expect(tela.novo.tag_rfid).toBe('0001234567');
    expect(tela.novo.qrcode_acesso).toBe('QR-9');
  });

  it('salvar sem mexer na tag nem no QR não os envia; alterar a tag envia só ela', async () => {
    const { tela, api } = build(jest.fn(() => of(ficha)));
    tela.abrirEditar(daLista);
    tela.novo.telefone = '(11) 99999-8888';
    await tela.salvar();
    const corpo1 = (api.update.mock.calls[0] as any[])[1];
    expect(corpo1).not.toHaveProperty('tag_rfid');
    expect(corpo1).not.toHaveProperty('qrcode_acesso');

    tela.abrirEditar(daLista);
    tela.novo.tag_rfid = '0009999999';
    await tela.salvar();
    const corpo2 = (api.update.mock.calls[1] as any[])[1];
    expect(corpo2.tag_rfid).toBe('0009999999');
    expect(corpo2).not.toHaveProperty('qrcode_acesso');
  });

  it('ficha que não abre: mostra o erro e não abre o formulário (não monta tag vazia)', () => {
    const { tela, toast } = build(jest.fn(() => throwError(() => ({ error: { message: 'Morador 5 não encontrado' } }))));
    tela.abrirEditar(daLista);
    expect(tela.showForm).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Morador 5 não encontrado');
  });

  it('o painel de detalhes lê tag e QR da ficha', () => {
    const { tela, api } = build(jest.fn(() => of(ficha)));
    tela.abrirDetalhes(daLista);
    expect(api.get).toHaveBeenCalledWith(5);
    expect(tela.selectedMorador()?.tag_rfid).toBe('0001234567');
    expect(tela.selectedMorador()?.qrcode_acesso).toBe('QR-9');
  });
});
