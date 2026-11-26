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

/** O vinculo define quem vota em pauta "somente proprietarios": nao ha padrao silencioso. */
describe('MoradoresPageComponent — vinculo explicito', () => {
  afterEach(() => TestBed.resetTestingModule());

  function build() {
    const create = jest.fn(() => of({ id: 9 }));
    TestBed.configureTestingModule({
      imports: [MoradoresPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MoradoresApi, useValue: { list: jest.fn(() => of([])), create } },
        { provide: VeiculosApi, useValue: {} },
        { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
        { provide: ConfirmService, useValue: { ask: jest.fn(async () => true) } },
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }), token: '' } },
        { provide: ToastService, useValue: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    });
    const fixture = TestBed.createComponent(MoradoresPageComponent);
    fixture.detectChanges();
    return { tela: fixture.componentInstance, create };
  }

  it('morador novo nasce sem vinculo e nao salva sem escolher', async () => {
    const { tela, create } = build();
    tela.novo = { ...tela.novo, nome: 'Bia', id_apartamento: 1 } as any;
    expect(tela.novo.tipo).toBe('');
    await tela.salvar();
    expect(create).not.toHaveBeenCalled();
    expect(tela.error()).toContain('vínculo');
  });
});
