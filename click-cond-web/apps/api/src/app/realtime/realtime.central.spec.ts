import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway, SALA_CENTRAL } from './realtime.gateway';
import { criarAdaptadorRedis } from './redis-adapter';

jest.mock('./redis-adapter', () => ({ criarAdaptadorRedis: jest.fn() }));

describe('RealtimeGateway â€” sala central do operador', () => {
  const jwt = new JwtService({ secret: 'test' });

  function build() {
    // validate simulado: o suporte real a papel 'operador_central' vem na Task 6.
    const strategy = { validate: jest.fn(async (p: any) => p) };
    const gw = new RealtimeGateway(jwt, { get: jest.fn(() => strategy) } as any);
    (gw as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    return gw;
  }
  const socket = (token: string) =>
    ({ handshake: { auth: { token }, query: {} }, data: {} as any, join: jest.fn(), disconnect: jest.fn() }) as any;

  it('operador_central sem id_condominio conecta e entra na sala central', async () => {
    const gw = build();
    const s = socket(jwt.sign({ sub: 7, papel: 'operador_central', cred: 'x' }));
    await gw.handleConnection(s);
    expect(s.join).toHaveBeenCalledTimes(1);
    expect(s.join).toHaveBeenCalledWith(SALA_CENTRAL);
    expect(SALA_CENTRAL).toBe('central');
    expect(s.disconnect).not.toHaveBeenCalled();
  });

  it('token sem id_condominio e sem papel continua desconectado', async () => {
    const gw = build();
    const s = socket(jwt.sign({ sub: 7, nome: 'X' }));
    await gw.handleConnection(s);
    expect(s.join).not.toHaveBeenCalled();
    expect(s.disconnect).toHaveBeenCalledWith(true);
  });

  it('porteiro continua entrando em condominio:<id> e portaria:<id>', async () => {
    const gw = build();
    const s = socket(jwt.sign({ sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' }));
    await gw.handleConnection(s);
    expect(s.join).toHaveBeenCalledWith('condominio:7');
    expect(s.join).toHaveBeenCalledWith('portaria:7');
    expect(s.join).not.toHaveBeenCalledWith(SALA_CENTRAL);
  });

  it('centralOnline usa fetchSockets da sala central e devolve false em erro', async () => {
    const gw = build();
    const fetchSockets = jest.fn(async () => [{ id: 'a' }]);
    (gw as any).server = { in: jest.fn(() => ({ fetchSockets })) };
    await expect(gw.centralOnline()).resolves.toBe(true);
    expect((gw as any).server.in).toHaveBeenCalledWith('central');
    fetchSockets.mockResolvedValueOnce([]);
    await expect(gw.centralOnline()).resolves.toBe(false);
    fetchSockets.mockRejectedValueOnce(new Error('x'));
    await expect(gw.centralOnline()).resolves.toBe(false);
  });

  it('emitirCentral emite na sala central', () => {
    const gw = build();
    const emit = jest.fn();
    (gw as any).server = { to: jest.fn(() => ({ emit })) };
    gw.emitirCentral('central:x', { a: 1 });
    expect((gw as any).server.to).toHaveBeenCalledWith('central');
    expect(emit).toHaveBeenCalledWith('central:x', { a: 1 });
  });

  it('afterInit aplica o adaptador Redis quando REDIS_URL existe', async () => {
    const gw = build();
    const adaptador = jest.fn();
    (criarAdaptadorRedis as jest.Mock).mockResolvedValue(adaptador);
    const server = { adapter: jest.fn() };
    process.env['REDIS_URL'] = 'redis://x';
    try {
      await gw.afterInit(server as any);
      expect(server.adapter).toHaveBeenCalledWith(adaptador);
    } finally {
      delete process.env['REDIS_URL'];
      gw.onModuleDestroy();
    }
  });

  it('o timer de reconferência começa mesmo com o adaptador pendente', async () => {
    const gw = build();
    (criarAdaptadorRedis as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const pendente = gw.afterInit({ adapter: jest.fn() } as any);
    try {
      expect((gw as any).timer).toBeDefined();
    } finally {
      gw.onModuleDestroy();
    }
    void pendente;
  });
});
