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
 * Celular perdido: o operador (síndico ou porteiro) cancela o passe da carteira
 * do morador na edição dele. A rota é POST credenciais/wallet/morador/:id/cancelar
 * e devolve `{ ok, cancelados }`; o QR do app e o rosto continuam valendo.
 */

describe('MoradoresApi.cancelarPasseCarteira', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 3 }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('faz POST na rota do operador', () => {
    let r: unknown;
    TestBed.inject(MoradoresApi).cancelarPasseCarteira(42).subscribe((v) => (r = v));
    const req = http.expectOne(`${API_BASE}/credenciais/wallet/morador/42/cancelar`);
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, cancelados: 1 });
    expect(r).toEqual({ ok: true, cancelados: 1 });
  });
});

describe('MoradoresPageComponent — Cancelar passe da carteira', () => {
  afterEach(() => TestBed.resetTestingModule());

  function build(cancelarPasseCarteira: jest.Mock, confirmar = true) {
    const toast = { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() };
    const confirm = { ask: jest.fn(() => Promise.resolve(confirmar)) };
    TestBed.configureTestingModule({
      imports: [MoradoresPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MoradoresApi, useValue: { cancelarPasseCarteira, list: jest.fn(() => of([])) } },
        {
          provide: VeiculosApi,
          useValue: { listByMorador: jest.fn(() => of([])), listTags: jest.fn(() => of([])) },
        },
        { provide: ApartamentosApi, useValue: { list: jest.fn(() => of([])) } },
        { provide: ConfirmService, useValue: confirm },
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 1 }), token: '' } },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    });
    const fixture = TestBed.createComponent(MoradoresPageComponent);
    return { fixture, tela: fixture.componentInstance, toast, confirm };
  }

  const morador = { id: 5, nome: 'Bia Souza', id_apartamento: 7, tipo: 'proprietario' } as any;
  const botao = (el: HTMLElement) => el.querySelector('button[data-cancelar-passe]') as HTMLButtonElement | null;

  it('cadastro novo: sem o botão', () => {
    const { fixture, tela } = build(jest.fn());
    tela.abrirNovo();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cadastrar novo morador');
    expect(botao(fixture.nativeElement)).toBeNull();
  });

  it('editando um morador existente: o botão aparece', () => {
    const { fixture, tela } = build(jest.fn());
    tela.abrirEditar(morador);
    fixture.detectChanges();
    expect(botao(fixture.nativeElement)?.textContent).toContain('Cancelar passe da carteira');
  });

  it('pede confirmação com o nome e chama a API do morador em edição', async () => {
    const cancelar = jest.fn(() => of({ ok: true as const, cancelados: 2 }));
    const { tela, confirm, toast } = build(cancelar);
    tela.abrirEditar(morador);

    await tela.cancelarPasseCarteira();

    expect(confirm.ask).toHaveBeenCalledTimes(1);
    expect((confirm.ask.mock.calls[0] as any[])[0].message).toBe(
      'Cancelar o passe da carteira de Bia Souza? O passe deixa de abrir na hora. O QR do app e o rosto continuam funcionando.',
    );
    expect(cancelar).toHaveBeenCalledWith(5);
    expect(toast.success).toHaveBeenCalledWith('Passe cancelado.');
  });

  it('sem passe ativo: avisa que o morador não tinha passe', async () => {
    const { tela, toast } = build(jest.fn(() => of({ ok: true as const, cancelados: 0 })));
    tela.abrirEditar(morador);

    await tela.cancelarPasseCarteira();

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Este morador não tinha passe ativo.');
  });

  it('recusar a confirmação não chama a API', async () => {
    const cancelar = jest.fn(() => of({ ok: true as const, cancelados: 1 }));
    const { tela } = build(cancelar, false);
    tela.abrirEditar(morador);

    await tela.cancelarPasseCarteira();

    expect(cancelar).not.toHaveBeenCalled();
  });

  it('erro do servidor mostra a mensagem dele e mantém o formulário aberto', async () => {
    const cancelar = jest.fn(() =>
      throwError(() => ({ error: { message: 'Acesso negado: cancelar o passe da carteira exige operador.' } })),
    );
    const { tela, toast } = build(cancelar);
    tela.abrirEditar(morador);

    await tela.cancelarPasseCarteira();

    expect(toast.error).toHaveBeenCalledWith('Acesso negado: cancelar o passe da carteira exige operador.');
    expect(tela.showForm).toBe(true);
    expect(tela.editingId).toBe(5);
    expect(tela.cancelandoPasse()).toBe(false);
  });
});
