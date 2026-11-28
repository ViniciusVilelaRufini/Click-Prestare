const connect = jest.fn(async () => undefined);
const destroy = jest.fn();
const duplicate = jest.fn();
const pub = { connect, duplicate, destroy, on: jest.fn() };
const createClient = jest.fn((_o: any) => pub);
duplicate.mockImplementation(() => ({ connect, destroy, on: jest.fn() }));
jest.mock('redis', () => ({ createClient: (o: any) => createClient(o) }));
const createAdapter = jest.fn(() => 'CLASSICO');
const createShardedAdapter = jest.fn(() => 'ADAPTADOR');
jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: (...a: any[]) => (createAdapter as any)(...a),
  createShardedAdapter: (...a: any[]) => (createShardedAdapter as any)(...a),
}));

import { criarAdaptadorRedis } from './redis-adapter';

describe('criarAdaptadorRedis', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sem URL devolve null', async () => {
    await expect(criarAdaptadorRedis(undefined)).resolves.toBeNull();
    await expect(criarAdaptadorRedis('')).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rediss:// com cliente simulado devolve o adaptador e o cliente da presença (o pub)', async () => {
    await expect(criarAdaptadorRedis('rediss://x')).resolves.toEqual({ adaptador: 'ADAPTADOR', redis: pub });
    expect(createClient).toHaveBeenCalledWith({ url: 'rediss://x' });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('usa o adaptador sharded (SSUBSCRIBE/SPUBLISH) em modo dynamic: o ElastiCache Serverless recusa PSUBSCRIBE', async () => {
    await criarAdaptadorRedis('redis://x');
    expect(createAdapter).not.toHaveBeenCalled();
    expect(createShardedAdapter).toHaveBeenCalledTimes(1);
    const [p, s, opcoes] = createShardedAdapter.mock.calls[0] as any[];
    expect(p).toBe(pub);
    expect(s).not.toBe(pub);
    expect(opcoes).toEqual({ subscriptionMode: 'dynamic' });
  });

  it('erro de conexão devolve null', async () => {
    connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(criarAdaptadorRedis('redis://x')).resolves.toBeNull();
  });

  it('Redis que nunca responde: devolve null após o timeout e destrói os dois clientes', async () => {
    jest.useFakeTimers();
    try {
      connect.mockImplementation(() => new Promise<void>(() => undefined));
      const p = criarAdaptadorRedis('redis://inalcancavel');
      await jest.advanceTimersByTimeAsync(5_100);
      await expect(p).resolves.toBeNull();
      expect(destroy).toHaveBeenCalledTimes(2);
      expect(createShardedAdapter).not.toHaveBeenCalled();
    } finally {
      connect.mockImplementation(async () => undefined);
      jest.useRealTimers();
    }
  });
});
