import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';
import { MoradoresPageComponent } from './moradores-page.component';
import { MoradoresApi } from './moradores.service';
import { VeiculosApi } from './veiculos.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { ToastService } from '../shared/toast.service';

describe('MoradoresPageComponent — Editar abre o formulário no mesmo clique (zoneless)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a ficha chega por HTTP e o formulário aparece sem detectChanges', async () => {
    const daLista = {
      id: 5, nome: 'Bia Souza', email: null, documento: null, telefone: null, data_nascimento: null,
      tipo: 'proprietario', bloco: 'A', apartamento: '101', id_apartamento: 7, id_condominio: 1,
      photo: null, foto_pessoa: null, foto_documento: null, tem_conta_app: false,
    } as any;
    const ficha$ = new Subject<any>();
    const api = {
      list: jest.fn(() => of([daLista])),
      get: jest.fn(() => ficha$),
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
        { provide: ToastService, useValue: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    });
    const fixture = TestBed.createComponent(MoradoresPageComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Editar morador');

    const editar = fixture.nativeElement.querySelector('button[aria-label="Editar morador"]') as HTMLButtonElement;
    editar.click();
    await fixture.whenStable(); // o CD do clique passou; a ficha ainda não chegou
    expect(fixture.componentInstance.showForm).toBe(false);

    ficha$.next({ ...daLista, tag_rfid: 'T1', qrcode_acesso: 'Q1' });
    ficha$.complete();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();

    expect(fixture.componentInstance.showForm).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Editar morador');
  });
});
