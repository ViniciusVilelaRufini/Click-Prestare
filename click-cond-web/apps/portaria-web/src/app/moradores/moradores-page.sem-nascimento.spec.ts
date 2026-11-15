import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { MoradoresPageComponent } from './moradores-page.component';
import { MoradoresApi } from './moradores.service';
import { VeiculosApi } from './veiculos.service';
import { ApartamentosApi } from '../apartamentos/apartamentos.service';
import { ConfirmService } from '../shared/confirm.service';
import { AuthService } from '../auth/auth.service';
import { ToastService } from '../shared/toast.service';

/** Rodada 4, item 1c: sem a data de nascimento o morador não recebe acesso — a lista mostra quem falta. */
describe('MoradoresPageComponent — sem data de nascimento', () => {
  afterEach(() => TestBed.resetTestingModule());

  const m = (id: number, data_nascimento: string | null) => ({
    id, nome: `M${id}`, email: null, documento: null, telefone: null, data_nascimento, tipo: 'proprietario',
    bloco: 'A', apartamento: '101', id_apartamento: 7, id_condominio: 1, photo: null, foto_pessoa: null, foto_documento: null,
  });

  function build() {
    TestBed.configureTestingModule({
      imports: [MoradoresPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MoradoresApi, useValue: { list: jest.fn(() => of([m(1, '1980-01-01'), m(2, null), m(3, null)])) } },
        { provide: VeiculosApi, useValue: {} },
        { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
        { provide: ConfirmService, useValue: { ask: jest.fn() } },
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }), token: '' } },
        { provide: ToastService, useValue: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    });
    const fixture = TestBed.createComponent(MoradoresPageComponent);
    fixture.detectChanges();
    return { fixture, tela: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('conta quem está sem a data e mostra no filtro', () => {
    const { tela, el } = build();
    expect(tela.stats().semNascimento).toBe(2);
    expect(el.querySelector('[data-filtro-sem-nascimento]')?.textContent).toContain('Sem data de nascimento (2)');
  });

  it('o filtro deixa só quem está sem a data', () => {
    const { tela } = build();
    tela.filtroTipo.set(tela.filtroSemNascimento);
    expect(tela.moradoresFiltrados().map((x) => x.id)).toEqual([2, 3]);
  });

  it('a linha de quem está sem a data ganha o selo', () => {
    const { el } = build();
    // Cartão (celular) e tabela (desktop): um selo em cada, para os dois sem data.
    expect(el.querySelectorAll('[data-selo-sem-nascimento]').length).toBe(4);
  });
});
