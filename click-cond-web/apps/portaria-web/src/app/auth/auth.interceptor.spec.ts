import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { NetworkStatusService } from '../core/network-status.service';

describe('authInterceptor - Tratamento de Erros e Queda de Rede', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let network: NetworkStatusService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        NetworkStatusService,
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    network = TestBed.inject(NetworkStatusService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('deve traduzir erro com status 0 (rede caiu) para mensagem amigável no objeto de erro', (done) => {
    http.get('/api/condominios/1/apartamentos').subscribe({
      next: () => fail('Deveria ter falhado com status 0'),
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(0);
        expect(err.message).not.toContain('Http failure response');
        expect(err.message).toContain('Sem conexão com o servidor');
        expect(err.error?.message).toContain('Sem conexão com o servidor');
        expect(network.isServerReachable()).toBe(false);
        done();
      },
    });

    const req = httpMock.expectOne('/api/condominios/1/apartamentos');
    req.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
  });

  it('deve notificar network.reportHttpSuccess quando a requisição for bem sucedida', (done) => {
    // Simula que antes estava com erro
    network.isServerReachable.set(false);

    http.get('/api/condominios/1/apartamentos').subscribe({
      next: (res) => {
        expect(res).toEqual([{ id: 1 }]);
        expect(network.isServerReachable()).toBe(true);
        done();
      },
      error: () => fail('Deveria ter dado sucesso'),
    });

    const req = httpMock.expectOne('/api/condominios/1/apartamentos');
    req.flush([{ id: 1 }], { headers: { Date: new Date().toUTCString() } });
  });
});
