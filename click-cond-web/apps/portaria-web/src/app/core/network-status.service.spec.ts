import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { NetworkStatusService } from './network-status.service';

describe('NetworkStatusService', () => {
  let service: NetworkStatusService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [NetworkStatusService],
    });
    service = TestBed.inject(NetworkStatusService);
  });

  it('deve inicializar com status online por padrão no ambiente de teste', () => {
    expect(service.isOnline()).toBe(true);
    expect(service.isServerReachable()).toBe(true);
    expect(service.hasConnectionIssue()).toBe(false);
  });

  it('deve marcar isServerReachable como false quando reportHttpError com status 0', () => {
    const error = new HttpErrorResponse({
      error: new ProgressEvent('error'),
      status: 0,
      statusText: 'Unknown Error',
      url: '/api/condominios/1/apartamentos',
    });

    service.reportHttpError(error);

    expect(service.isServerReachable()).toBe(false);
    expect(service.hasConnectionIssue()).toBe(true);
  });

  it('deve recuperar isServerReachable quando reportHttpSuccess for chamado', () => {
    const error = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    service.reportHttpError(error);
    expect(service.hasConnectionIssue()).toBe(true);

    service.reportHttpSuccess();
    expect(service.isServerReachable()).toBe(true);
    expect(service.hasConnectionIssue()).toBe(false);
    expect(service.reconnectedRecently()).toBe(true);
  });

  it('deve traduzir erro de status 0 em mensagem clara para o porteiro em vez do Http failure cru', () => {
    const error = new HttpErrorResponse({
      status: 0,
      statusText: 'Unknown Error',
      url: '/api/condominios/1/apartamentos',
    });

    const msg = service.getFriendlyErrorMessage(error, 'Falha ao carregar apartamentos');
    expect(msg).not.toContain('Http failure response');
    expect(msg).not.toContain('0 undefined');
    expect(msg).toContain('Sem conexão');
    expect(msg).toContain('Falha ao carregar apartamentos');
  });

  it('deve priorizar mensagem de erro do backend quando existir (ex: 400 ou 403 com JSON message)', () => {
    const error = new HttpErrorResponse({
      status: 403,
      statusText: 'Forbidden',
      error: { message: 'Apenas o síndico pode executar esta ação.' },
    });

    const msg = service.getFriendlyErrorMessage(error);
    expect(msg).toBe('Apenas o síndico pode executar esta ação.');
  });
});
