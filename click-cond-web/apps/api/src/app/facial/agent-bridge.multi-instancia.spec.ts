import { AgentBridgeService } from './agent-bridge.service';

/**
 * API em 2 instâncias: o operador enfileira o comando na instância A, o
 * agente faz poll e devolve o resultado na instância B. Com a fila num Map do
 * processo, o comando "sumia". Aqui as duas instâncias dividem um banco falso.
 */
function bancoFalso() {
  const comandos = new Map<string, any>();
  const estados = new Map<number, any>();
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
      findMany: jest.fn(async ({ where }: any) => [...comandos.values()].filter((l) => casa(l, where))),
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
      findUnique: jest.fn(async ({ where }: any) => estados.get(where.id_device) ?? null),
      findMany: jest.fn(async () => [...estados.values()]),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const atual = estados.get(where.id_device);
        estados.set(where.id_device, atual ? { ...atual, ...update } : { ticket_aberto: 0, ...create });
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const atual = estados.get(where.id_device) ?? { id_device: where.id_device, ticket_aberto: 0 };
        if (atual.ticket_aberto !== where.ticket_aberto) return { count: 0 };
        estados.set(where.id_device, { ...atual, ...data });
        return { count: 1 };
      }),
    },
  };
  return { prisma, comandos, estados };
}

describe('AgentBridgeService — duas instâncias', () => {
  const instancias: AgentBridgeService[] = [];
  afterEach(() => {
    for (const i of instancias.splice(0)) i.onModuleDestroy();
  });
  const criar = (prisma: any) => {
    const i = new AgentBridgeService(prisma);
    instancias.push(i);
    return i;
  };

  it('comando enfileirado na instância A é entregue pelo poll na B e o resultado volta para A', async () => {
    const { prisma, comandos } = bancoFalso();
    const a = criar(prisma);
    const b = criar(prisma);

    // O agente fez poll na B; A só sabe disso pelo banco.
    await b.poll(5);
    await (a as any).atualizarCache();
    expect(a.isOnline(5)).toBe(true);

    const resultado = a.enqueue(5, { type: 'open_door' });
    await new Promise((r) => setImmediate(r));

    const entregues = await b.poll(5);
    expect(entregues).toHaveLength(1);
    expect(entregues[0].type).toBe('open_door');
    // Entrega única: outro poll (na A) não recebe o mesmo comando.
    expect(await a.poll(5)).toEqual([]);

    await b.submitResult(entregues[0].id, { ok: true, statusCode: 200 });
    await expect(resultado).resolves.toEqual({ ok: true, statusCode: 200 });
    expect(comandos.size).toBe(0);
  });

  it('telemetria gravada numa instância é lida na outra', async () => {
    const { prisma } = bancoFalso();
    const estado = new Map<string, any>();
    prisma.estado_Compartilhado = {
      upsert: jest.fn(async ({ where, create, update }: any) =>
        estado.set(where.chave, estado.has(where.chave) ? { ...estado.get(where.chave), ...update } : create),
      ),
      findUnique: jest.fn(async ({ where }: any) => estado.get(where.chave) ?? null),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    };
    const a = criar(prisma);
    const b = criar(prisma);
    await a.setTelemetria(7, { versao: '2026.11.04', so: 'win', iniciado_em: 'x', dispositivos: [], eventos_pendentes: 0 });
    expect((await b.getTelemetria(7))?.versao).toBe('2026.11.04');
  });

  it('aparelho offline há 10 min: só UMA instância abre a ocorrência', async () => {
    const { prisma, estados } = bancoFalso();
    const a = criar(prisma);
    const b = criar(prisma);
    await a.reportDeviceStatus(9, false);
    estados.get(9).offline_desde = new Date(Date.now() - 11 * 60 * 1000);

    const [ra, rb] = await Promise.all([a.reportDeviceStatus(9, false), b.reportDeviceStatus(9, false)]);
    expect([ra.shouldOpenTicket, rb.shouldOpenTicket].filter(Boolean)).toHaveLength(1);

    const volta = await b.reportDeviceStatus(9, true);
    expect(volta.shouldResolveTicket).toBe(true);
    expect(volta.changed).toBe(true);
  });

  // Fix round 1 (C-1): deploy antes do SQL 2026-11-04-multi-instancia.sql.
  it('tabelas ausentes (P2021): cai para a fila em memória, abre a porta e loga ERROR uma vez só', async () => {
    const p2021 = () => Object.assign(new Error('The table `agente_comandos` does not exist'), { code: 'P2021' });
    const falha = jest.fn(async () => {
      throw p2021();
    });
    const prisma: any = {
      isConnected: true,
      agente_Comandos: { create: falha, findMany: falha, updateMany: falha, deleteMany: falha },
      agente_Dispositivos_Estado: { findUnique: falha, findMany: falha, upsert: falha, updateMany: falha },
    };
    const i = criar(prisma);
    const erro = jest.spyOn((i as any).logger, 'error').mockImplementation(() => undefined);

    await i.poll(4); // heartbeat (o upsert falha com P2021 em segundo plano)
    const r = i.enqueue(4, { type: 'open_door' });
    await new Promise((res) => setImmediate(res)); // create rejeita → fila em memória
    const cmds = await i.poll(4);
    expect(cmds.map((c) => c.type)).toEqual(['open_door']);
    await i.submitResult(cmds[0].id, { ok: true });
    await expect(r).resolves.toEqual({ ok: true });

    // status do aparelho também segue em memória
    const st = await i.reportDeviceStatus(4, false);
    expect(st.shouldOpenTicket).toBe(false);

    const avisos = erro.mock.calls.filter((c) => String(c[0]).includes('multi-instancia.sql'));
    expect(avisos).toHaveLength(1);
  });

  it('sem banco continua tudo em memória (uma instância)', async () => {
    const i = criar(undefined);
    await i.poll(3);
    const r = i.enqueue(3, { type: 'ping' });
    const [cmd] = await i.poll(3);
    await i.submitResult(cmd.id, { ok: true });
    await expect(r).resolves.toEqual({ ok: true });
  });
});
