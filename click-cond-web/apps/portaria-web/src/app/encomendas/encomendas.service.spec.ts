import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { NEVER } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { EncomendasApi } from './encomendas.service';

describe('EncomendasApi.lerEtiqueta', () => {
  afterEach(() => jest.useRealTimers());

  it('desiste após 20 s (timeout do cliente) com erro, para o formulário seguir manual', () => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { post: jest.fn(() => NEVER) } },
        { provide: AuthService, useValue: { porteiroInfo: () => ({ id_condominio: 7 }) } },
      ],
    });
    const api = TestBed.inject(EncomendasApi);
    const erro = jest.fn();
    const next = jest.fn();

    api.lerEtiqueta('data:image/jpeg;base64,QUFB').subscribe({ next, error: erro });
    jest.advanceTimersByTime(19_999);
    expect(erro).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(next).not.toHaveBeenCalled();
    expect(erro).toHaveBeenCalledTimes(1);
    expect(erro.mock.calls[0][0]?.name).toBe('TimeoutError');
  });
});
