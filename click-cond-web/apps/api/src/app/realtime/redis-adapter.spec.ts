const connect = jest.fn(async () => undefined);
const duplicate = jest.fn();
const createClient = jest.fn((_o: any) => ({ connect, duplicate, on: jest.fn() }));
duplicate.mockImplementation(() => ({ connect, on: jest.fn() }));
jest.mock('redis', () => ({ createClient: (o: any) => createClient(o) }));
const createAdapter = jest.fn(() => 'ADAPTADOR');
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: (...a: any[]) => (createAdapter as any)(...a) }));

import { criarAdaptadorRedis } from './redis-adapter';

describe('criarAdaptadorRedis', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sem URL devolve null', async () => {
    await expect(criarAdaptadorRedis(undefined)).resolves.toBeNull();
    await expect(criarAdaptadorRedis('')).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rediss:// com cliente simulado devolve o adaptador', async () => {
    await expect(criarAdaptadorRedis('rediss://x')).resolves.toBe('ADAPTADOR');
    expect(createClient).toHaveBeenCalledWith({ url: 'rediss://x' });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(createAdapter).toHaveBeenCalled();
  });

  it('erro de conexão devolve null', async () => {
    connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(criarAdaptadorRedis('redis://x')).resolves.toBeNull();
  });
});
