import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CentralAuthService } from './central-auth.service';
import { CentralRealtimeService } from './central-realtime.service';

const ioMock = jest.fn();
jest.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }));

/**
 * Socket da Central: conexão própria com o central_token (o do porteiro nunca vai). Token com trocar_senha é
 * recusado pelo servidor, então depois da troca de senha o socket reconecta com o token novo.
 */
describe('CentralRealtimeService', () => {
  function build(token: string | null = 'tok-central') {
    const auth = { token, tokenRenovado$: new Subject<string>() };
    const handlers = new Map<string, ((d?: unknown) => void)[]>();
    const socket = {
      connected: false,
      active: true,
      disconnect: jest.fn(),
      connect: jest.fn(),
      on: jest.fn((ev: string, cb: (d?: unknown) => void) => {
        handlers.set(ev, [...(handlers.get(ev) ?? []), cb]);
      }),
      off: jest.fn(),
      disparar: (ev: string, d?: unknown) => handlers.get(ev)?.forEach((cb) => cb(d)),
    };
    ioMock.mockReset().mockReturnValue(socket);
    TestBed.configureTestingModule({ providers: [{ provide: CentralAuthService, useValue: auth }] });
    return { svc: TestBed.inject(CentralRealtimeService), auth, socket };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('conecta em /api/socket.io mandando o central_token a cada (re)conexão', () => {
    const { svc, auth } = build();
    svc.on('interfone:chamada', () => undefined);
    expect(ioMock).toHaveBeenCalledTimes(1);
    const opcoes = ioMock.mock.calls[0][1];
    expect(opcoes.path).toBe('/api/socket.io');
    const lido = jest.fn();
    auth.token = 'tok-novo';
    opcoes.auth(lido);
    expect(lido).toHaveBeenCalledWith({ token: 'tok-novo' });
  });

  it('sem token não conecta', () => {
    const { svc } = build(null);
    svc.on('interfone:chamada', () => undefined);
    expect(ioMock).not.toHaveBeenCalled();
  });

  it('ouvintes entram no socket e o estado acompanha a conexão', () => {
    const { svc, socket } = build();
    const cb = jest.fn();
    svc.on('alerta:novo', cb);
    socket.disparar('alerta:novo', { id: 1 });
    expect(cb).toHaveBeenCalledWith({ id: 1 });
    socket.disparar('connect');
    expect(svc.conectado()).toBe(true);
    socket.disparar('disconnect');
    expect(svc.conectado()).toBe(false);
  });

  it('token renovado (troca de senha) reconecta o mesmo socket com o token novo', () => {
    const { svc, auth, socket } = build();
    svc.on('interfone:chamada', () => undefined);
    auth.token = 'tok-novo';
    auth.tokenRenovado$.next('tok-novo');
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.connect).toHaveBeenCalled();
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('desconectar fecha o socket e esquece os ouvintes', () => {
    const { svc, socket } = build();
    svc.on('interfone:chamada', () => undefined);
    svc.desconectar();
    expect(socket.disconnect).toHaveBeenCalled();
    expect(svc.conectado()).toBe(false);
    svc.on('interfone:fim', () => undefined);
    expect(ioMock).toHaveBeenCalledTimes(2);
  });
});
