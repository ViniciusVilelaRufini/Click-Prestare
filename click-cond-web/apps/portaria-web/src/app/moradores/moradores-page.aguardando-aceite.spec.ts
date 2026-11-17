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

/** Aceite pendente vale mais que um face_sync_status antigo de 'pending'/'error'. */
describe('MoradoresPageComponent — selo Aguardando aceite', () => {
  afterEach(() => TestBed.resetTestingModule());

  const m = (id: number, face_sync_status: string) => ({
    id, nome: `M${id}`, email: null, documento: null, telefone: null, data_nascimento: '1980-01-01',
    tipo: 'proprietario', bloco: 'A', apartamento: '101', id_apartamento: 7, id_condominio: 1,
    photo: null, foto_pessoa: 'f.jpg', foto_documento: null, face_sync_status,
    aguardando_aceite_biometria: true,
  });

  it.each(['pending', 'error'])('com face_sync_status %s mostra Aguardando aceite (no app)', (status) => {
    TestBed.configureTestingModule({
      imports: [MoradoresPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MoradoresApi, useValue: { list: jest.fn(() => of([m(1, status)])) } },
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
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Aguardando aceite (no app)');
    expect(texto).not.toContain('Sinc.');
    expect(texto).not.toMatch(/\bErro\b/);
  });
});
