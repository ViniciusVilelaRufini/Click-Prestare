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
    const socket = { connected: true, active: true, disconnect: jest.fn(), connect: jest.fn(), on: jest.fn(), off: jest.fn() };
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

/**
 * Interfone: o painel de chamada do porteiro precisa do socket aberto o tempo todo. `on` registra um ouvinte que
 * sobrevive a um socket novo, e o `disconnect` de uma tela (visitantes) não derruba o socket enquanto houver ouvinte.
 * `conectado` diz ao painel se a central de eventos caiu.
 */
describe('RealtimeService — ouvintes persistentes e estado da conexão', () => {
  function criarSocket() {
    const handlers = new Map<string, ((d?: unknown) => void)[]>();
    const s = {
      connected: false,
      active: true,
      disconnect: jest.fn(() => { s.active = false; s.connected = false; }),
      connect: jest.fn(),
      on: jest.fn((ev: string, cb: (d?: unknown) => void) => { handlers.set(ev, [...(handlers.get(ev) ?? []), cb]); }),
      off: jest.fn((ev: string, cb: (d?: unknown) => void) => { handlers.set(ev, (handlers.get(ev) ?? []).filter((f) => f !== cb)); }),
      emitir(ev: string, d?: unknown) { (handlers.get(ev) ?? []).forEach((f) => f(d)); },
    };
    return s;
  }
  function build() {
    const auth = { token: 'tok' as string | null, tokenRenovado$: new Subject<string>() };
    const sockets: ReturnType<typeof criarSocket>[] = [];
    ioMock.mockReset().mockImplementation(() => { const s = criarSocket(); sockets.push(s); return s; });
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    return { svc: TestBed.inject(RealtimeService), sockets };
  }
  afterEach(() => TestBed.resetTestingModule());

  it('on conecta, entrega o evento e o cancelamento tira o ouvinte', () => {
    const { svc, sockets } = build();
    const cb = jest.fn();
    const cancelar = svc.on('interfone:chamada', cb);
    expect(sockets).toHaveLength(1);
    sockets[0].emitir('interfone:chamada', { id: 1 });
    expect(cb).toHaveBeenCalledWith({ id: 1 });
    cancelar();
    sockets[0].emitir('interfone:chamada', { id: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('conectado acompanha connect/disconnect do socket', () => {
    const { svc, sockets } = build();
    svc.on('interfone:fim', jest.fn());
    expect(svc.conectado()).toBe(false);
    sockets[0].emitir('connect');
    expect(svc.conectado()).toBe(true);
    sockets[0].emitir('disconnect');
    expect(svc.conectado()).toBe(false);
  });

  it('disconnect de outra tela não derruba o socket enquanto há ouvinte persistente', () => {
    const { svc, sockets } = build();
    const cancelar = svc.on('interfone:chamada', jest.fn());
    svc.connect();
    svc.disconnect();
    expect(sockets[0].disconnect).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1); // connect() reaproveitou o socket que ainda tenta conectar
    cancelar();
    svc.disconnect();
    expect(sockets[0].disconnect).toHaveBeenCalled();
  });

  it('socket novo recebe os ouvintes persistentes', () => {
    const { svc, sockets } = build();
    const cb = jest.fn();
    svc.on('interfone:chamada', cb);
    sockets[0].disconnect(); // ex.: derrubado; o próximo connect cria outro
    svc.connect();
    expect(sockets).toHaveLength(2);
    sockets[1].emitir('interfone:chamada', { id: 9 });
    expect(cb).toHaveBeenCalledWith({ id: 9 });
  });
});
