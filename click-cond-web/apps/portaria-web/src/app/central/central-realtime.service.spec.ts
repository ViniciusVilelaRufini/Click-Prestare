import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { CentralAuthService } from './central-auth.service';
import { CentralRealtimeService } from './central-realtime.service';
import { tokenDeTeste } from './central.testing';

const ioMock = jest.fn();
jest.mock('socket.io-client', () => ({ io: (...args: any[]) => ioMock(...args) }));

/**
 * Socket da Central: conexão própria com o central_token (o do porteiro nunca vai). Token com trocar_senha é
 * recusado pelo servidor, então depois da troca de senha o socket reconecta com o token novo.
 */
describe('CentralRealtimeService', () => {
  function build(token: string | null = 'tok-central') {
    const auth = { token, tokenRenovado$: new Subject<string>(), recarregar: jest.fn() };
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

  describe('servidor derrubou o socket (io server disconnect)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('com o token da central ainda válido, reconecta depois de 5 s e o estado mostra a reconexão', () => {
      const { svc, socket } = build(tokenDeTeste());
      svc.on('interfone:chamada', () => undefined);
      socket.disparar('connect');
      socket.disparar('disconnect', 'io server disconnect');
      expect(svc.conectado()).toBe(false);
      expect(svc.reconectando()).toBe(true);
      jest.advanceTimersByTime(4_999);
      expect(socket.connect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(socket.connect).toHaveBeenCalledTimes(1);
      socket.disparar('connect');
      expect(svc.conectado()).toBe(true);
      expect(svc.reconectando()).toBe(false);
    });

    it('quedas seguidas dobram a espera até o teto de 60 s; conexão estável zera', () => {
      const { svc, socket } = build(tokenDeTeste());
      svc.on('interfone:chamada', () => undefined);
      const esperas: number[] = [];
      for (let i = 0; i < 6; i++) {
        const antes = socket.connect.mock.calls.length;
        socket.disparar('connect');
        socket.disparar('disconnect', 'io server disconnect');
        let ms = 0;
        while (socket.connect.mock.calls.length === antes && ms < 120_000) {
          jest.advanceTimersByTime(1_000);
          ms += 1_000;
        }
        esperas.push(ms);
      }
      expect(esperas).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);

      // Ficou conectado um bom tempo: a próxima queda volta para 5 s.
      socket.disparar('connect');
      jest.advanceTimersByTime(60_000);
      const antes = socket.connect.mock.calls.length;
      socket.disparar('disconnect', 'io server disconnect');
      jest.advanceTimersByTime(5_000);
      expect(socket.connect.mock.calls.length).toBe(antes + 1);
    });

    it('token vencido ou ausente: não reconecta e relê a sessão (a tela volta ao login)', () => {
      const { svc, auth, socket } = build(tokenDeTeste());
      svc.on('interfone:chamada', () => undefined);
      auth.token = tokenDeTeste({ exp: Math.floor(Date.now() / 1000) - 10 });
      socket.disparar('disconnect', 'io server disconnect');
      jest.advanceTimersByTime(120_000);
      expect(socket.connect).not.toHaveBeenCalled();
      expect(svc.reconectando()).toBe(false);
      expect(auth.recarregar).toHaveBeenCalled();
    });

    it('queda de rede (transport close) fica com a reconexão automática do socket.io', () => {
      const { svc, socket } = build(tokenDeTeste());
      svc.on('interfone:chamada', () => undefined);
      socket.disparar('disconnect', 'transport close');
      jest.advanceTimersByTime(120_000);
      expect(socket.connect).not.toHaveBeenCalled();
      expect(svc.reconectando()).toBe(false);
    });

    it('desconectar (saída da Central) cancela a reconexão agendada', () => {
      const { svc, socket } = build(tokenDeTeste());
      svc.on('interfone:chamada', () => undefined);
      socket.disparar('disconnect', 'io server disconnect');
      svc.desconectar();
      jest.advanceTimersByTime(120_000);
      expect(socket.connect).not.toHaveBeenCalled();
      expect(svc.reconectando()).toBe(false);
    });
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
