import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { RealtimeService } from './realtime.service';

const ioMock = jest.fn();
jest.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }));

/**
 * Correção 1 (raia s): depois de o console trocar a senha (ou o condomínio), a API emite um token novo e o antigo
 * deixa de valer — inclusive no socket. O socket aberto tem de reconectar com o token novo, sem perder os
 * listeners que as telas registraram.
 */
describe('RealtimeService — token renovado', () => {
  function build() {
    const auth = { token: 'tok-antigo' as string | null, tokenRenovado$: new Subject<string>() };
    const socket = { connected: true, disconnect: jest.fn(), connect: jest.fn() };
    ioMock.mockReset().mockReturnValue(socket);
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    return { svc: TestBed.inject(RealtimeService), auth, socket };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('cada (re)conexão manda o token atual da sessão', () => {
    const { svc, auth } = build();
    svc.connect();
    const opcoes = ioMock.mock.calls[0][1];
    const lido = jest.fn();
    auth.token = 'tok-novo';
    opcoes.auth(lido);
    expect(lido).toHaveBeenCalledWith({ token: 'tok-novo' });
  });

  it('token renovado reconecta o mesmo socket (os listeners ficam)', () => {
    const { svc, auth, socket } = build();
    svc.connect();
    auth.token = 'tok-novo';
    auth.tokenRenovado$.next('tok-novo');
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.connect).toHaveBeenCalled();
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('sem socket aberto, token renovado não faz nada', () => {
    const { auth } = build();
    TestBed.inject(RealtimeService);
    auth.tokenRenovado$.next('tok-novo');
    expect(ioMock).not.toHaveBeenCalled();
  });
});
