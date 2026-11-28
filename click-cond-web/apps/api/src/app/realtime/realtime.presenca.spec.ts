import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway, SALA_CENTRAL } from './realtime.gateway';
import { criarAdaptadorRedis } from './redis-adapter';

jest.mock('./redis-adapter', () => ({ criarAdaptadorRedis: jest.fn() }));

/**
 * ElastiCache Serverless: o fetchSockets entre réplicas volta 0 (PUBSUB SHARDNUMSUB sempre 0). "Há porteiro /
 * operador online?" passa a ser: sala local do adaptador; se vazia, a presença própria no Redis (ZSET por sala).
 */
describe('RealtimeGateway — presença entre réplicas', () => {
  const jwt = new JwtService({ secret: 'test' });
  const tokenPorteiro = jwt.sign({ sub: 3, nome: 'P', id_condominio: 7, tipo_sub: 'funcionario_portaria' });
  const tokenOperador = jwt.sign({ sub: 7, papel: 'operador_central', cred: 'x' });

  /** Servidor com as salas locais do adaptador (Map sala → ids), como o socket.io mantém. */
  function servidor() {
    const rooms = new Map<string, Set<string>>();
    const adapter = { rooms };
    return {
      rooms,
      adapter: jest.fn(),
      of: jest.fn(() => ({ adapter })),
      to: jest.fn(() => ({ emit: jest.fn() })),
      in: jest.fn(() => ({ fetchSockets: jest.fn(async () => { throw new Error('não deve usar fetchSockets'); }) })),
    };
  }

  function presencaFalsa(outras = false) {
    return {
      anunciar: jest.fn(async () => undefined),
      outrasReplicasNaSala: jest.fn(async () => outras),
      encerrar: jest.fn(async (_salas: string[]) => undefined),
    };
  }

  function build(server = servidor(), presenca: ReturnType<typeof presencaFalsa> | null = presencaFalsa()) {
    const strategy = { validate: jest.fn(async (p: any) => p) };
    const gw = new RealtimeGateway(jwt, { get: jest.fn(() => strategy) } as any);
    (gw as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    (gw as any).server = server;
    (gw as any).presenca = presenca;
    return { gw, server, presenca };
  }

  let seq = 0;
  /** Socket cujo join/leave mexe nas salas locais do servidor simulado. */
  function socket(server: ReturnType<typeof servidor>, token: string) {
    const id = `s${++seq}`;
    const salas = new Set<string>();
    return {
      id,
      handshake: { auth: { token }, query: {} },
      data: {} as any,
      disconnect: jest.fn(),
      join: jest.fn((sala: string) => {
        if (!server.rooms.has(sala)) server.rooms.set(sala, new Set());
        server.rooms.get(sala)!.add(id);
        salas.add(sala);
      }),
      /** O que o socket.io faz antes de chamar handleDisconnect: tira o socket de todas as salas. */
      sair() {
        for (const sala of salas) {
          const ids = server.rooms.get(sala);
          ids?.delete(id);
          if (ids && ids.size === 0) server.rooms.delete(sala);
        }
        salas.clear();
      },
    } as any;
  }

  it('porteiro local → true sem consultar o Redis (e sem fetchSockets)', async () => {
    const { gw, server, presenca } = build();
    server.rooms.set('portaria:7', new Set(['a']));
    await expect(gw.porteirosOnline(7)).resolves.toBe(true);
    expect(presenca!.outrasReplicasNaSala).not.toHaveBeenCalled();
    expect(server.in).not.toHaveBeenCalled();
    expect(server.of).toHaveBeenCalledWith('/');
  });

  it('operador local → centralOnline true sem consultar o Redis', async () => {
    const { gw, server, presenca } = build();
    server.rooms.set(SALA_CENTRAL, new Set(['a']));
    await expect(gw.centralOnline()).resolves.toBe(true);
    expect(presenca!.outrasReplicasNaSala).not.toHaveBeenCalled();
  });

  it('sem ninguém local + outra réplica com a sala → true', async () => {
    const { gw, presenca } = build(servidor(), presencaFalsa(true));
    await expect(gw.porteirosOnline(7)).resolves.toBe(true);
    expect(presenca!.outrasReplicasNaSala).toHaveBeenCalledWith('portaria:7');
    await expect(gw.centralOnline()).resolves.toBe(true);
    expect(presenca!.outrasReplicasNaSala).toHaveBeenCalledWith(SALA_CENTRAL);
  });

  it('sem ninguém local nem em outra réplica → false', async () => {
    const { gw } = build(servidor(), presencaFalsa(false));
    await expect(gw.porteirosOnline(7)).resolves.toBe(false);
    await expect(gw.centralOnline()).resolves.toBe(false);
  });

  it('presença que lança não derruba: false', async () => {
    const p = presencaFalsa();
    p.outrasReplicasNaSala.mockRejectedValue(new Error('x'));
    const { gw } = build(servidor(), p);
    await expect(gw.porteirosOnline(7)).resolves.toBe(false);
    await expect(gw.centralOnline()).resolves.toBe(false);
  });

  it('sem Redis (presença desligada) → só a contagem local, como antes', async () => {
    const { gw, server } = build(servidor(), null);
    await expect(gw.porteirosOnline(7)).resolves.toBe(false);
    server.rooms.set('portaria:7', new Set(['a']));
    await expect(gw.porteirosOnline(7)).resolves.toBe(true);
  });

  it('porteiro que entra anuncia a sala da portaria (a do condomínio não é vigiada)', async () => {
    const { gw, server, presenca } = build();
    await gw.handleConnection(socket(server, tokenPorteiro));
    expect(presenca!.anunciar).toHaveBeenCalledWith('portaria:7', true);
    expect(presenca!.anunciar).not.toHaveBeenCalledWith('condominio:7', expect.anything());
  });

  it('operador que entra anuncia a sala central', async () => {
    const { gw, server, presenca } = build();
    await gw.handleConnection(socket(server, tokenOperador));
    expect(presenca!.anunciar).toHaveBeenCalledWith(SALA_CENTRAL, true);
  });

  it('disconnect que esvazia a sala → anúncio inativo (ZREM); sala ainda ocupada → nada', async () => {
    const { gw, server, presenca } = build();
    const s1 = socket(server, tokenPorteiro);
    const s2 = socket(server, tokenPorteiro);
    await gw.handleConnection(s1);
    await gw.handleConnection(s2);
    presenca!.anunciar.mockClear();

    s1.sair();
    await gw.handleDisconnect(s1);
    expect(presenca!.anunciar).not.toHaveBeenCalled();

    s2.sair();
    await gw.handleDisconnect(s2);
    expect(presenca!.anunciar).toHaveBeenCalledWith('portaria:7', false);
    expect(presenca!.anunciar).toHaveBeenCalledTimes(1);
  });

  it('sem Redis, conexão e disconnect não tentam anunciar nada', async () => {
    const { gw, server } = build(servidor(), null);
    const s = socket(server, tokenPorteiro);
    await gw.handleConnection(s);
    s.sair();
    await expect(gw.handleDisconnect(s)).resolves.toBeUndefined();
    expect(s.join).toHaveBeenCalledWith('portaria:7');
  });

  it('renovação reanuncia as salas vigiadas com sockets locais e retira as que esvaziaram', async () => {
    const { gw, server, presenca } = build();
    const s1 = socket(server, tokenPorteiro);
    const s2 = socket(server, tokenOperador);
    await gw.handleConnection(s1);
    await gw.handleConnection(s2);
    presenca!.anunciar.mockClear();

    // Sumiu sem passar pelo handleDisconnect (ex.: o anúncio de saída falhou): a renovação corrige.
    s2.sair();
    await gw.renovarPresenca();
    expect(presenca!.anunciar).toHaveBeenCalledWith('portaria:7', true);
    expect(presenca!.anunciar).toHaveBeenCalledWith(SALA_CENTRAL, false);
    expect(presenca!.anunciar).not.toHaveBeenCalledWith('condominio:7', expect.anything());

    // A sala retirada não é retirada de novo.
    presenca!.anunciar.mockClear();
    await gw.renovarPresenca();
    expect(presenca!.anunciar).toHaveBeenCalledTimes(1);
    expect(presenca!.anunciar).toHaveBeenCalledWith('portaria:7', true);
  });

  it('renovação também pega sala com socket local que nunca foi anunciada', async () => {
    const { gw, server, presenca } = build();
    server.rooms.set('portaria:9', new Set(['x']));
    server.rooms.set('x', new Set(['x'])); // sala própria do socket
    await gw.renovarPresenca();
    expect(presenca!.anunciar).toHaveBeenCalledWith('portaria:9', true);
    expect(presenca!.anunciar).toHaveBeenCalledTimes(1);
  });

  it('rodadas concorrentes: enquanto uma renovação roda, a próxima não dispara outra', async () => {
    const { gw, server, presenca } = build();
    server.rooms.set('portaria:7', new Set(['a']));
    let liberar!: () => void;
    presenca!.anunciar.mockImplementation(() => new Promise<undefined>((r) => (liberar = () => r(undefined))));

    const primeira = gw.renovarPresenca();
    await Promise.resolve();
    expect(presenca!.anunciar).toHaveBeenCalledTimes(1);
    // Redis travado: as rodadas seguintes (timer de 5 s) não empilham comandos.
    await gw.renovarPresenca();
    await gw.renovarPresenca();
    expect(presenca!.anunciar).toHaveBeenCalledTimes(1);

    liberar();
    await primeira;
    presenca!.anunciar.mockImplementation(async () => undefined);
    await gw.renovarPresenca();
    expect(presenca!.anunciar).toHaveBeenCalledTimes(2);
  });

  it('renovação anuncia as salas em paralelo, não em série', async () => {
    const { gw, server, presenca } = build();
    server.rooms.set('portaria:7', new Set(['a']));
    server.rooms.set('portaria:8', new Set(['b']));
    server.rooms.set(SALA_CENTRAL, new Set(['c']));
    const pendentes: Array<() => void> = [];
    presenca!.anunciar.mockImplementation(() => new Promise<undefined>((r) => pendentes.push(() => r(undefined))));
    const rodada = gw.renovarPresenca();
    await Promise.resolve();
    // As três saíram antes de qualquer uma responder.
    expect(presenca!.anunciar).toHaveBeenCalledTimes(3);
    pendentes.forEach((f) => f());
    await rodada;
  });

  it('retirada das salas que esvaziaram também é em paralelo', async () => {
    const { gw, server, presenca } = build();
    const a = socket(server, tokenPorteiro);
    const b = socket(server, tokenOperador);
    await gw.handleConnection(a);
    await gw.handleConnection(b);
    a.sair();
    b.sair();
    presenca!.anunciar.mockClear();
    const pendentes: Array<() => void> = [];
    presenca!.anunciar.mockImplementation(() => new Promise<undefined>((r) => pendentes.push(() => r(undefined))));
    const fim = gw.handleDisconnect(a);
    await Promise.resolve();
    expect(presenca!.anunciar).toHaveBeenCalledTimes(2);
    expect(presenca!.anunciar).toHaveBeenCalledWith('portaria:7', false);
    expect(presenca!.anunciar).toHaveBeenCalledWith(SALA_CENTRAL, false);
    pendentes.forEach((f) => f());
    await fim;
  });

  it('onModuleDestroy retira (best-effort) as salas anunciadas e desliga a presença', async () => {
    const { gw, server, presenca } = build();
    await gw.handleConnection(socket(server, tokenPorteiro));
    await gw.handleConnection(socket(server, tokenOperador));
    await gw.onModuleDestroy();
    expect(presenca!.encerrar).toHaveBeenCalledTimes(1);
    expect([...presenca!.encerrar.mock.calls[0][0]].sort()).toEqual([SALA_CENTRAL, 'portaria:7'].sort());
    expect((gw as any).presenca).toBeNull();
    // Depois do destroy, nada mais vai ao Redis.
    await gw.renovarPresenca();
    await expect(gw.porteirosOnline(99)).resolves.toBe(false);
    expect(presenca!.outrasReplicasNaSala).not.toHaveBeenCalled();
  });

  describe('afterInit com Redis', () => {
    afterEach(() => {
      delete process.env['REDIS_URL'];
      jest.useRealTimers();
    });

    it('aplica o adaptador, liga a presença com o cliente devolvido e renova a cada 5 s até o destroy', async () => {
      jest.useFakeTimers();
      const strategy = { validate: jest.fn(async (p: any) => p) };
      const gw = new RealtimeGateway(jwt, { get: jest.fn(() => strategy) } as any);
      (gw as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
      const server = servidor();
      (gw as any).server = server;
      const redis = {
        isReady: true,
        destroy: jest.fn(),
        zAdd: jest.fn(async () => 1),
        zRem: jest.fn(async () => 1),
        zRangeByScore: jest.fn(async () => [] as string[]),
        pExpire: jest.fn(async () => 1),
      };
      (criarAdaptadorRedis as jest.Mock).mockResolvedValue({ adaptador: 'ADAPTADOR', redis });
      process.env['REDIS_URL'] = 'rediss://x';
      try {
        await gw.afterInit(server as any);
        expect(server.adapter).toHaveBeenCalledWith('ADAPTADOR');
        expect((gw as any).presenca).toBeTruthy();

        server.rooms.set(SALA_CENTRAL, new Set(['a']));
        await jest.advanceTimersByTimeAsync(4_999);
        expect(redis.zAdd).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(redis.zAdd).toHaveBeenCalledWith('rt:presenca:central', expect.objectContaining({ score: expect.any(Number) }));

        await gw.onModuleDestroy();
        expect(redis.zRem).toHaveBeenCalledWith('rt:presenca:central', expect.any(String));
        expect(redis.destroy).toHaveBeenCalledTimes(1);
        redis.zAdd.mockClear();
        await jest.advanceTimersByTimeAsync(10_000);
        expect(redis.zAdd).not.toHaveBeenCalled();
      } finally {
        gw.onModuleDestroy();
      }
    });

    it('sem Redis (null) a presença fica desligada', async () => {
      const strategy = { validate: jest.fn(async (p: any) => p) };
      const gw = new RealtimeGateway(jwt, { get: jest.fn(() => strategy) } as any);
      const server = servidor();
      (criarAdaptadorRedis as jest.Mock).mockResolvedValue(null);
      try {
        await gw.afterInit(server as any);
        expect(server.adapter).not.toHaveBeenCalled();
        expect((gw as any).presenca).toBeFalsy();
      } finally {
        gw.onModuleDestroy();
      }
    });
  });
});
