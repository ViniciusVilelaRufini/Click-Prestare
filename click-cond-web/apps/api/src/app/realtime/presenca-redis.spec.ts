import { CONSULTA_PRESENCA_MS, ID_REPLICA, PRESENCA_TTL_MS, PresencaRedis, chavePresenca, type ClientePresenca } from './presenca-redis';

/** ZSET em memória com a mesma semântica dos quatro comandos usados (todos de uma chave só). */
function redisFalso() {
  const zsets = new Map<string, Map<string, number>>();
  const expira = new Map<string, number>();
  const cliente = {
    zsets,
    expira,
    isReady: true,
    destroy: jest.fn(),
    zAdd: jest.fn(async (chave: string, m: { value: string; score: number }) => {
      if (!zsets.has(chave)) zsets.set(chave, new Map());
      zsets.get(chave)!.set(String(m.value), m.score);
      return 1;
    }),
    zRem: jest.fn(async (chave: string, membro: string) => (zsets.get(chave)?.delete(membro) ? 1 : 0)),
    zRangeByScore: jest.fn(async (chave: string, min: number | string, max: number | string) => {
      const teto = max === '+inf' ? Infinity : Number(max);
      return [...(zsets.get(chave) ?? new Map<string, number>())]
        .filter(([, s]) => s >= Number(min) && s <= teto)
        .map(([v]) => v);
    }),
    pExpire: jest.fn(async (chave: string, ms: number) => {
      expira.set(chave, ms);
      return 1;
    }),
  };
  return cliente;
}

describe('PresencaRedis — presença por sala entre réplicas (ElastiCache Serverless)', () => {
  let agora = 1_000_000;
  const relogio = () => agora;
  beforeEach(() => {
    agora = 1_000_000;
  });

  it('chave por sala com prefixo rt:presenca:', () => {
    expect(chavePresenca('portaria:7')).toBe('rt:presenca:portaria:7');
    expect(PRESENCA_TTL_MS).toBe(15_000);
    expect(CONSULTA_PRESENCA_MS).toBe(2_000);
  });

  it('anunciar(ativo) faz ZADD com score agora+TTL e PEXPIRE de 2×TTL; anunciar(inativo) faz ZREM', async () => {
    const r = redisFalso();
    const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
    await p.anunciar('central', true);
    expect(r.zAdd).toHaveBeenCalledWith('rt:presenca:central', { value: 'A', score: agora + 15_000 });
    expect(r.pExpire).toHaveBeenCalledWith('rt:presenca:central', 30_000);
    expect(r.zsets.get('rt:presenca:central')?.get('A')).toBe(agora + 15_000);

    await p.anunciar('central', false);
    expect(r.zRem).toHaveBeenCalledWith('rt:presenca:central', 'A');
    expect(r.zsets.get('rt:presenca:central')?.has('A')).toBe(false);
  });

  it('outra réplica presente na sala → true; só a própria → false', async () => {
    const r = redisFalso();
    const a = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
    const b = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'B', agora: relogio });

    await a.anunciar('portaria:7', true);
    await expect(a.outrasReplicasNaSala('portaria:7')).resolves.toBe(false);
    await expect(b.outrasReplicasNaSala('portaria:7')).resolves.toBe(true);
    expect(r.zRangeByScore).toHaveBeenCalledWith('rt:presenca:portaria:7', agora, '+inf');

    // Outra sala não se mistura.
    await expect(b.outrasReplicasNaSala('portaria:8')).resolves.toBe(false);
  });

  it('anúncio vencido (sem renovação além do TTL) não conta mais', async () => {
    const r = redisFalso();
    const a = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
    const b = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'B', agora: relogio });
    await a.anunciar('central', true);
    agora += 14_999;
    await expect(b.outrasReplicasNaSala('central')).resolves.toBe(true);
    agora += 2;
    await expect(b.outrasReplicasNaSala('central')).resolves.toBe(false);
  });

  it('ZREM da outra réplica (sala esvaziou) → false', async () => {
    const r = redisFalso();
    const a = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
    const b = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'B', agora: relogio });
    await a.anunciar('central', true);
    await a.anunciar('central', false);
    await expect(b.outrasReplicasNaSala('central')).resolves.toBe(false);
  });

  it('Redis que lança: consulta devolve false e o anúncio não lança', async () => {
    const r = redisFalso();
    r.zRangeByScore.mockRejectedValue(new Error('ECONNRESET'));
    r.zAdd.mockRejectedValue(new Error('ECONNRESET'));
    r.zRem.mockRejectedValue(new Error('ECONNRESET'));
    const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
    (p as any).logger = { warn: jest.fn(), log: jest.fn() };
    await expect(p.outrasReplicasNaSala('central')).resolves.toBe(false);
    await expect(p.anunciar('central', true)).resolves.toBeUndefined();
    await expect(p.anunciar('central', false)).resolves.toBeUndefined();
  });

  it('Redis que demora: consulta devolve false em até 2 s', async () => {
    jest.useFakeTimers();
    try {
      const r = redisFalso();
      r.zRangeByScore.mockImplementation(() => new Promise<string[]>(() => undefined));
      const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
      (p as any).logger = { warn: jest.fn(), log: jest.fn() };
      let resultado: boolean | undefined;
      void p.outrasReplicasNaSala('central').then((v: boolean) => (resultado = v));
      await jest.advanceTimersByTimeAsync(1_999);
      expect(resultado).toBeUndefined();
      await jest.advanceTimersByTimeAsync(1);
      expect(resultado).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Redis que demora no anúncio: também desiste em 2 s sem lançar', async () => {
    jest.useFakeTimers();
    try {
      const r = redisFalso();
      r.zAdd.mockImplementation(() => new Promise<number>(() => undefined));
      const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
      (p as any).logger = { warn: jest.fn(), log: jest.fn() };
      let fim = false;
      void p.anunciar('central', true).then(() => (fim = true));
      await jest.advanceTimersByTimeAsync(1_999);
      expect(fim).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(fim).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('cliente fora do ar (isReady=false): nada enfileira', () => {
    it('anunciar é no-op e a consulta responde false na hora, sem mandar comando', async () => {
      const r = redisFalso();
      r.isReady = false;
      const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
      (p as any).logger = { warn: jest.fn(), log: jest.fn() };
      await p.anunciar('central', true);
      await p.anunciar('central', false);
      expect(r.zAdd).not.toHaveBeenCalled();
      expect(r.pExpire).not.toHaveBeenCalled();
      expect(r.zRem).not.toHaveBeenCalled();

      jest.useFakeTimers();
      try {
        let resultado: boolean | undefined;
        void p.outrasReplicasNaSala('central').then((v: boolean) => (resultado = v));
        await jest.advanceTimersByTimeAsync(0);
        expect(resultado).toBe(false);
        expect(r.zRangeByScore).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('voltou (isReady=true): anuncia e consulta de novo', async () => {
      const r = redisFalso();
      r.isReady = false;
      const a = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
      const b = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'B', agora: relogio });
      (a as any).logger = { warn: jest.fn(), log: jest.fn() };
      await a.anunciar('central', true);
      r.isReady = true;
      await a.anunciar('central', true);
      await expect(b.outrasReplicasNaSala('central')).resolves.toBe(true);
    });
  });

  describe('logs: um aviso por transição, não por sala', () => {
    it('Redis fora em várias salas e rodadas → um aviso; voltou → um log; caiu de novo → outro aviso', async () => {
      const r = redisFalso();
      const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
      const logger = { warn: jest.fn(), log: jest.fn() };
      (p as any).logger = logger;

      r.isReady = false;
      for (let i = 0; i < 3; i++) {
        await p.anunciar('central', true);
        await p.anunciar('portaria:7', true);
        await p.outrasReplicasNaSala('portaria:8');
      }
      expect(logger.warn).toHaveBeenCalledTimes(1);

      r.isReady = true;
      await p.anunciar('central', true);
      await p.anunciar('portaria:7', true);
      expect(logger.log).toHaveBeenCalledTimes(1);

      r.zAdd.mockRejectedValue(new Error('ECONNRESET'));
      r.zRangeByScore.mockRejectedValue(new Error('ECONNRESET'));
      await p.anunciar('central', true);
      await p.anunciar('portaria:7', true);
      await p.outrasReplicasNaSala('central');
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe('encerrar (destroy do módulo)', () => {
    it('ZREM das salas informadas e destrói o cliente da presença', async () => {
      const r = redisFalso();
      const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
      await p.anunciar('central', true);
      await p.anunciar('portaria:7', true);
      await p.encerrar(['central', 'portaria:7']);
      expect(r.zRem).toHaveBeenCalledWith('rt:presenca:central', 'A');
      expect(r.zRem).toHaveBeenCalledWith('rt:presenca:portaria:7', 'A');
      expect(r.destroy).toHaveBeenCalledTimes(1);
    });

    it('ZREM que não responde: desiste em 2 s e destrói assim mesmo', async () => {
      jest.useFakeTimers();
      try {
        const r = redisFalso();
        r.zRem.mockImplementation(() => new Promise<0 | 1>(() => undefined));
        const p = new PresencaRedis(r as unknown as ClientePresenca, { idReplica: 'A', agora: relogio });
        (p as any).logger = { warn: jest.fn(), log: jest.fn() };
        let fim = false;
        void p.encerrar(['central', 'portaria:7']).then(() => (fim = true));
        await jest.advanceTimersByTimeAsync(1_999);
        expect(fim).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(fim).toBe(true);
        expect(r.destroy).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('id da réplica é aleatório por processo quando não informado', () => {
    const r = redisFalso() as unknown as ClientePresenca;
    const a = new PresencaRedis(r);
    expect(a.idReplica).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a.idReplica).toBe(ID_REPLICA);
  });
});
