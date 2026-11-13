import { AgentController } from './agent.controller';
import { AgentBridgeService } from './agent-bridge.service';
import { AgentVersionService } from './agent-version.service';

/**
 * Fila de comandos do Agente Local:
 *  - o resultado só vale se o comando é de um device do token que o postou;
 *  - o tempo de espera depende do tipo do comando;
 *  - o poll do condomínio lê a fila de TODOS os devices numa consulta só.
 */

/** Banco falso com as duas tabelas da ponte (mesma ideia de agent-bridge.multi-instancia.spec.ts). */
function bancoFalso() {
  const comandos = new Map<string, any>();
  const casa = (l: any, where: any) =>
    Object.entries(where).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if ('in' in v) return v.in.includes(l[k]);
        if ('gt' in v) return l[k] > v.gt;
        if ('lt' in v) return l[k] < v.lt;
      }
      return l[k] === v;
    });
  const prisma: any = {
    isConnected: true,
    agente_Comandos: {
      create: jest.fn(async ({ data }: any) => comandos.set(data.id, { criado_em: new Date(), resultado: null, ...data })),
      findMany: jest.fn(async ({ where, orderBy }: any) => {
        const linhas = [...comandos.values()].filter((l) => casa(l, where));
        if (orderBy?.criado_em === 'asc') linhas.sort((a, b) => a.criado_em.getTime() - b.criado_em.getTime());
        return linhas;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const l of comandos.values()) if (casa(l, where)) (Object.assign(l, data), count++);
        return { count };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        let count = 0;
        for (const l of [...comandos.values()]) if (casa(l, where)) (comandos.delete(l.id), count++);
        return { count };
      }),
    },
    agente_Dispositivos_Estado: {
      findUnique: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      upsert: jest.fn(async () => undefined),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  /** Grava um comando pendente direto na tabela (como se OUTRA instância tivesse enfileirado). */
  const gravar = (id: string, idDevice: number, criadoEmMs: number, type = 'open_door') =>
    comandos.set(id, {
      id,
      id_device: idDevice,
      comando: JSON.stringify({ type, id }),
      status: 'pendente',
      resultado: null,
      criado_em: new Date(criadoEmMs),
      expira_em: new Date(Date.now() + 60_000),
    });
  return { prisma, comandos, gravar };
}

const instancias: AgentBridgeService[] = [];
const criar = (prisma?: any) => {
  const i = new AgentBridgeService(prisma);
  instancias.push(i);
  return i;
};
afterEach(() => {
  for (const i of instancias.splice(0)) {
    i.onModuleDestroy();
    // Comandos que o teste deixou sem resultado: solta o timer de expiração
    // (15–25 s) para o worker do Jest não ficar pendurado.
    for (const p of (i as any).pending.values()) clearTimeout(p.timer);
  }
  jest.useRealTimers();
  delete process.env.AGENT_COMMAND_TIMEOUT_MS;
});

const tick = () => new Promise((r) => setImmediate(r));

describe('resultado de comando: só de device do token que postou', () => {
  describe('AgentBridgeService.submitResult', () => {
    it('em memória: resultado vindo de outro device é ignorado e o comando continua esperando', async () => {
      const b = criar();
      await b.poll(5);
      const r = b.enqueue(5, { type: 'open_door' });
      const [cmd] = await b.poll(5);
      let resolvido: any = null;
      void r.then((v) => (resolvido = v));

      await b.submitResult(cmd.id, { ok: true, statusCode: 200 }, [6, 7]);
      await tick();
      expect(resolvido).toBeNull();

      await b.submitResult(cmd.id, { ok: false, error: 'porta travada' }, [5]);
      await expect(r).resolves.toEqual({ ok: false, error: 'porta travada' });
    });

    it('no banco (resultado chega em outra instância): só grava se o comando é de um device permitido', async () => {
      const { prisma, comandos, gravar } = bancoFalso();
      const b = criar(prisma);
      gravar('cmd-do-9', 9, 1);
      comandos.get('cmd-do-9').status = 'entregue';

      await b.submitResult('cmd-do-9', { ok: true }, [5, 6]);
      expect(comandos.get('cmd-do-9')).toMatchObject({ status: 'entregue', resultado: null });

      await b.submitResult('cmd-do-9', { ok: true }, [9]);
      expect(comandos.get('cmd-do-9')).toMatchObject({ status: 'concluido', resultado: JSON.stringify({ ok: true }) });
    });

    it('lista de devices vazia não aceita nada', async () => {
      const { prisma, comandos, gravar } = bancoFalso();
      const b = criar(prisma);
      gravar('c1', 9, 1);
      await b.submitResult('c1', { ok: true }, []);
      expect(comandos.get('c1').status).toBe('pendente');
    });

    // O corpo da rota é público: um objeto no lugar do id viraria filtro do Prisma.
    it.each([[{ not: '' }], [{ contains: '' }], [123], [null], [['c1']]])(
      'commandId que não é string (%j) é ignorado',
      async (idForjado) => {
        const { prisma, comandos, gravar } = bancoFalso();
        const b = criar(prisma);
        gravar('c1', 9, 1);
        await b.submitResult(idForjado as any, { ok: true }, [9]);
        expect(comandos.get('c1').status).toBe('pendente');
        expect(prisma.agente_Comandos.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('AgentController', () => {
    function montar() {
      // Condomínio 7 tem os devices 5 e 6 (tokens tok-5, tok-6, agente tok-condo-7);
      // o condomínio 8 tem o device 9 (tok-9, tok-condo-8).
      const devices = [
        { id: 5, id_condominio: 7, tipo: 'facial', fabricante: 'intelbras', token: 'tok-5' },
        { id: 6, id_condominio: 7, tipo: 'facial', fabricante: 'hikvision', token: 'tok-6' },
        { id: 9, id_condominio: 8, tipo: 'facial', fabricante: 'intelbras', token: 'tok-9' },
      ];
      const service: any = {
        findDeviceByToken: jest.fn(async (token: string) => {
          const d = devices.find((x) => x.token === token);
          if (!d) throw new Error('Token de webhook inválido');
          return d;
        }),
        resolveAgente: jest.fn(async (token: string) => {
          const m = /^tok-condo-(\d+)$/.exec(token);
          if (!m) throw new Error('Token do agente inválido');
          return { idCondominio: Number(m[1]) };
        }),
        getActiveDevices: jest.fn(async (id: number) => devices.filter((d) => d.id_condominio === id)),
        syncAllForCondominio: jest.fn(),
      };
      const bridge = criar();
      const descoberta: any = { consumirPedido: jest.fn(async () => false) };
      const ctrl = new AgentController(service, bridge, {} as AgentVersionService, descoberta);
      return { ctrl, bridge };
    }

    /** Enfileira um comando para o device 5 e o entrega ao agente; devolve o id e a promessa do operador. */
    async function comandoEntregueDoDevice5(bridge: AgentBridgeService) {
      await bridge.poll(5);
      const promessa = bridge.enqueue(5, { type: 'open_door' });
      const [cmd] = await bridge.poll(5);
      let resolvido: any = null;
      void promessa.then((v) => (resolvido = v));
      return { id: cmd.id, promessa, resolvido: () => resolvido };
    }

    it('condo/result: token de OUTRO condomínio não resolve o comando (responde como comando desconhecido)', async () => {
      const { ctrl, bridge } = montar();
      const c = await comandoEntregueDoDevice5(bridge);

      await expect(ctrl.condoResult('tok-condo-8', { commandId: c.id, ok: true })).resolves.toEqual({ ok: true });
      await tick();
      expect(c.resolvido()).toBeNull();

      await expect(ctrl.condoResult('tok-condo-7', { commandId: c.id, ok: true, statusCode: 200 })).resolves.toEqual({ ok: true });
      await expect(c.promessa).resolves.toEqual({ ok: true, statusCode: 200 });
    });

    it('result (token do device): só o próprio device resolve o comando', async () => {
      const { ctrl, bridge } = montar();
      const c = await comandoEntregueDoDevice5(bridge);

      // device de outro condomínio e device vizinho do mesmo condomínio: nada acontece
      await expect(ctrl.result('tok-9', { commandId: c.id, ok: true })).resolves.toEqual({ ok: true });
      await expect(ctrl.result('tok-6', { commandId: c.id, ok: true })).resolves.toEqual({ ok: true });
      await tick();
      expect(c.resolvido()).toBeNull();

      await expect(ctrl.result('tok-5', { commandId: c.id, ok: false, statusCode: 500 })).resolves.toEqual({ ok: true });
      await expect(c.promessa).resolves.toEqual({ ok: false, statusCode: 500 });
    });

    it('token inválido continua recusado antes de qualquer coisa', async () => {
      const { ctrl, bridge } = montar();
      const c = await comandoEntregueDoDevice5(bridge);
      await expect(ctrl.condoResult('lixo', { commandId: c.id, ok: true })).rejects.toThrow('Token do agente inválido');
      await expect(ctrl.result('lixo', { commandId: c.id, ok: true })).rejects.toThrow('Token de webhook inválido');
      expect(c.resolvido()).toBeNull();
    });
  });
});

describe('tempo de espera por tipo de comando', () => {
  it.each([
    ['ping', 15_000],
    ['open_door', 15_000],
    ['remove', 15_000],
    ['snapshot', 15_000],
    ['enroll', 25_000],
    ['update', 25_000],
    ['list_users', 25_000],
    ['remove_users', 25_000],
  ] as const)('%s espera %i ms (base padrão de 15 s)', (type, ms) => {
    expect(criar().timeoutDoComando(type)).toBe(ms);
  });

  it('AGENT_COMMAND_TIMEOUT_MS continua sendo a base', () => {
    process.env.AGENT_COMMAND_TIMEOUT_MS = '2000';
    const b = criar();
    expect(b.timeoutDoComando('open_door')).toBe(2000);
    expect(b.timeoutDoComando('enroll')).toBe(3333);
  });

  it('tipo desconhecido usa a base', () => {
    expect(criar().timeoutDoComando('novidade' as any)).toBe(15_000);
  });

  it('open_door expira em 15 s; enroll ainda está esperando aos 24 s e expira aos 25 s', async () => {
    jest.useFakeTimers();
    const b = criar();
    jest.spyOn((b as any).logger, 'warn').mockImplementation(() => undefined);
    b.heartbeat(5);
    const estado = { porta: null as any, rosto: null as any };
    void b.enqueue(5, { type: 'open_door' }).then((r) => (estado.porta = r));
    void b.enqueue(5, { type: 'enroll', externalId: 'morador_1', fotoBase64: 'x' }).then((r) => (estado.rosto = r));

    await jest.advanceTimersByTimeAsync(14_999);
    expect(estado.porta).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(estado.porta).toEqual({ ok: false, error: 'Tempo esgotado: o agente local não respondeu.' });
    expect(estado.rosto).toBeNull();

    await jest.advanceTimersByTimeAsync(9_999);
    expect(estado.rosto).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(estado.rosto).toEqual({ ok: false, error: 'Tempo esgotado: o agente local não respondeu.' });
  });

  it('a validade gravada no banco (expira_em) acompanha o tempo do tipo', async () => {
    const { prisma, comandos } = bancoFalso();
    const b = criar(prisma);
    b.heartbeat(5);
    const antes = Date.now();
    void b.enqueue(5, { type: 'ping' });
    void b.enqueue(5, { type: 'update', faceId: 'morador_1' });
    await tick();
    const porTipo = (t: string) => [...comandos.values()].find((l) => JSON.parse(l.comando).type === t);
    const folga = 1_000;
    expect(porTipo('ping').expira_em.getTime() - antes).toBeLessThan(15_000 + folga);
    expect(porTipo('update').expira_em.getTime() - antes).toBeGreaterThanOrEqual(25_000);
    expect(porTipo('update').expira_em.getTime() - antes).toBeLessThan(25_000 + folga);
  });
});

describe('ttl_ms: o poll diz ao agente quanto falta para a nuvem desistir do comando (menos 3 s de trajeto)', () => {
  it('em memória: tempo restante do tipo menos a folga, medido na hora do poll', async () => {
    jest.useFakeTimers();
    const b = criar();
    jest.spyOn((b as any).logger, 'warn').mockImplementation(() => undefined);
    b.heartbeat(5);
    void b.enqueue(5, { type: 'open_door' });
    void b.enqueue(5, { type: 'enroll', externalId: 'morador_1' });
    await jest.advanceTimersByTimeAsync(2_000); // o agente só pergunta 2 s depois
    const cmds = await b.poll(5);
    expect(cmds.map((c) => [c.type, c.ttl_ms])).toEqual([
      ['open_door', 15_000 - 2_000 - 3_000],
      ['enroll', 25_000 - 2_000 - 3_000],
    ]);
  });

  it('em memória: nunca negativo — comando entregue a menos de 3 s do fim leva ttl_ms 0', async () => {
    jest.useFakeTimers();
    const b = criar();
    b.heartbeat(5);
    void b.enqueue(5, { type: 'open_door' });
    await jest.advanceTimersByTimeAsync(13_500);
    const [cmd] = await b.poll(5);
    expect(cmd.ttl_ms).toBe(0);
  });

  it('no banco: deriva do expira_em da linha (comando enfileirado por outra instância)', async () => {
    const { prisma, comandos, gravar } = bancoFalso();
    const b = criar(prisma);
    gravar('longe', 1, 100);
    gravar('perto', 1, 200);
    gravar('quase', 1, 300);
    comandos.get('longe').expira_em = new Date(Date.now() + 12_000);
    comandos.get('perto').expira_em = new Date(Date.now() + 4_000);
    comandos.get('quase').expira_em = new Date(Date.now() + 1_000);
    const cmds = await b.poll(1);
    const ttl = (id: string) => cmds.find((c) => c.id === id)!.ttl_ms!;
    expect(ttl('longe')).toBeGreaterThan(8_000);
    expect(ttl('longe')).toBeLessThanOrEqual(9_000);
    expect(ttl('perto')).toBeGreaterThan(0);
    expect(ttl('perto')).toBeLessThanOrEqual(1_000);
    expect(ttl('quase')).toBe(0);
  });

  it('o ttl_ms não é gravado no comando guardado (campo só da entrega) e o resultado continua valendo', async () => {
    const { prisma, comandos } = bancoFalso();
    const b = criar(prisma);
    b.heartbeat(5);
    const r = b.enqueue(5, { type: 'ping' });
    await tick();
    const [linha] = [...comandos.values()];
    expect(JSON.parse(linha.comando)).not.toHaveProperty('ttl_ms');
    const [cmd] = await b.poll(5);
    expect(typeof cmd.ttl_ms).toBe('number');
    await b.submitResult(cmd.id, { ok: true }, [5]);
    await expect(r).resolves.toEqual({ ok: true });
  });
});

describe('poll do condomínio: uma leitura da fila para todos os devices', () => {
  function montarCondo(prisma: any, ids: number[]) {
    const service: any = {
      resolveAgente: jest.fn(async () => ({ idCondominio: 7 })),
      getActiveDevices: jest.fn(async () =>
        ids.map((id) => ({ id, nome: `T${id}`, tipo: 'catraca', fabricante: 'intelbras', ip: `192.168.1.${id}`, porta: 80, api_user: 'admin', api_password: 'x' })),
      ),
      syncAllForCondominio: jest.fn(),
    };
    const bridge = criar(prisma);
    const descoberta: any = { consumirPedido: jest.fn(async () => false) };
    return { ctrl: new AgentController(service, bridge, {} as AgentVersionService, descoberta), bridge, service };
  }

  it('N devices geram 1 consulta de leitura em agente_comandos', async () => {
    const { prisma } = bancoFalso();
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const { ctrl } = montarCondo(prisma, ids);

    const r = await ctrl.condoPoll('tok');

    expect(r.devices.map((d: any) => d.device.id)).toEqual(ids);
    expect(prisma.agente_Comandos.findMany).toHaveBeenCalledTimes(1);
    const { where } = prisma.agente_Comandos.findMany.mock.calls[0][0];
    expect(where.id_device).toEqual({ in: ids });
    expect(where.status).toBe('pendente');
    expect(where.expira_em.gt).toBeInstanceOf(Date);
  });

  it('entrega a cada device só os comandos dele, na ordem de criação, e uma vez só', async () => {
    const { prisma, comandos, gravar } = bancoFalso();
    // gravados fora de ordem de propósito: quem ordena é o criado_em
    gravar('b2', 2, 300);
    gravar('a2', 1, 200, 'enroll');
    gravar('a1', 1, 100);
    gravar('b1', 2, 150);
    gravar('a3', 1, 400, 'ping');
    gravar('de-outro-condominio', 99, 50);
    const { ctrl } = montarCondo(prisma, [1, 2, 3]);

    const r = await ctrl.condoPoll('tok');
    const cmds = (id: number) => r.devices.find((d: any) => d.device.id === id)!.commands.map((c: any) => c.id);
    expect(cmds(1)).toEqual(['a1', 'a2', 'a3']);
    expect(cmds(2)).toEqual(['b1', 'b2']);
    expect(cmds(3)).toEqual([]);
    for (const id of ['a1', 'a2', 'a3', 'b1', 'b2']) expect(comandos.get(id).status).toBe('entregue');
    expect(comandos.get('de-outro-condominio').status).toBe('pendente');

    // entrega única: o poll seguinte não repete nada
    const de_novo = await ctrl.condoPoll('tok');
    expect(de_novo.devices.flatMap((d: any) => d.commands)).toEqual([]);
  });

  it('dois polls simultâneos (duas instâncias) não entregam o mesmo comando duas vezes', async () => {
    const { prisma, gravar } = bancoFalso();
    gravar('a1', 1, 100);
    gravar('b1', 2, 150);
    const a = montarCondo(prisma, [1, 2]);
    const b = montarCondo(prisma, [1, 2]);

    const [ra, rb] = await Promise.all([a.ctrl.condoPoll('tok'), b.ctrl.condoPoll('tok')]);
    const entregues = [...ra.devices, ...rb.devices].flatMap((d: any) => d.commands.map((c: any) => c.id)).sort();
    expect(entregues).toEqual(['a1', 'b1']);
  });

  it('comando vencido não é entregue', async () => {
    const { prisma, comandos, gravar } = bancoFalso();
    gravar('velho', 1, 100);
    comandos.get('velho').expira_em = new Date(Date.now() - 1);
    const { ctrl } = montarCondo(prisma, [1]);
    expect((await ctrl.condoPoll('tok')).devices[0].commands).toEqual([]);
  });

  it('marca heartbeat de todos e dispara o back-fill só para facial que reconectou', async () => {
    const { prisma } = bancoFalso();
    const { ctrl, bridge, service } = montarCondo(prisma, [1, 2]);
    service.getActiveDevices.mockResolvedValue([
      { id: 1, tipo: 'facial', fabricante: 'dahua' },
      { id: 2, tipo: 'catraca', fabricante: 'control_id' },
    ]);
    const r = await ctrl.condoPoll('tok');
    expect(bridge.isOnline(1)).toBe(true);
    expect(bridge.isOnline(2)).toBe(true);
    expect(service.syncAllForCondominio).toHaveBeenCalledTimes(1);
    expect(service.syncAllForCondominio).toHaveBeenCalledWith(7, { onlyPending: true });
    expect(r.devices[0].device.fabricante).toBe('intelbras');

    await ctrl.condoPoll('tok');
    expect(service.syncAllForCondominio).toHaveBeenCalledTimes(1);
  });

  it('sem banco: a fila em memória continua entregue por device', async () => {
    const { ctrl, bridge } = montarCondo(undefined, [1, 2]);
    await ctrl.condoPoll('tok'); // heartbeat
    void bridge.enqueue(2, { type: 'open_door' });
    void bridge.enqueue(1, { type: 'ping' });
    const r = await ctrl.condoPoll('tok');
    expect(r.devices.map((d: any) => d.commands.map((c: any) => c.type))).toEqual([['ping'], ['open_door']]);
  });

  it('tabelas ausentes (P2021): cai para a memória sem derrubar o poll', async () => {
    const falha = jest.fn(async () => {
      throw Object.assign(new Error('The table `agente_comandos` does not exist'), { code: 'P2021' });
    });
    const prisma: any = {
      isConnected: true,
      agente_Comandos: { create: falha, findMany: falha, updateMany: falha, deleteMany: falha },
      agente_Dispositivos_Estado: { findUnique: falha, findMany: falha, upsert: falha, updateMany: falha },
    };
    const { ctrl, bridge } = montarCondo(prisma, [1, 2]);
    jest.spyOn((bridge as any).logger, 'error').mockImplementation(() => undefined);
    const r = await ctrl.condoPoll('tok');
    expect(r.devices.map((d: any) => d.commands)).toEqual([[], []]);
  });
});
