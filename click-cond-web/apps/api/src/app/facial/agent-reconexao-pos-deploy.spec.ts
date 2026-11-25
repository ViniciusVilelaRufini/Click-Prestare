import { AgentBridgeService } from './agent-bridge.service';
import { AgentController } from './agent.controller';

/**
 * J8 (revisão ciclos-api-jobs): depois de um deploy, o `lastSeen` da instância
 * nova começa vazio e o cache do banco só é lido 5 s depois. O primeiro poll de
 * cada aparelho contava como "reconectou" e disparava o back-fill
 * `syncAllForCondominio({ onlyPending: true })` de todos os condomínios ao
 * mesmo tempo. Agora a reconexão só conta depois de ler o último poll gravado
 * no banco: quem fez poll na instância antiga há poucos segundos não reconectou.
 */
function bancoFalso(estadosIniciais: Array<{ id_device: number; ultimo_poll_em: Date | null }>) {
  const comandos = new Map<string, any>();
  const estados = new Map<number, any>(estadosIniciais.map((e) => [e.id_device, { ticket_aberto: 0, ...e }]));
  const prisma: any = {
    isConnected: true,
    agente_Comandos: {
      create: jest.fn(async ({ data }: any) => comandos.set(data.id, data)),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    agente_Dispositivos_Estado: {
      findUnique: jest.fn(async ({ where }: any) => estados.get(where.id_device) ?? null),
      findMany: jest.fn(async () => [...estados.values()]),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const atual = estados.get(where.id_device);
        estados.set(where.id_device, atual ? { ...atual, ...update } : { ticket_aberto: 0, ...create });
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  return prisma;
}

const assentar = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

describe('AgentController — reconexão logo depois do deploy (J8)', () => {
  const pontes: AgentBridgeService[] = [];
  afterEach(() => {
    for (const p of pontes.splice(0)) p.onModuleDestroy();
  });

  const F = (id: number) => ({
    id, tipo: 'facial', fabricante: 'intelbras', id_condominio: 7, ultima_sincr: new Date(), nome: `F${id}`,
  });

  function montar(ultimoPollHaMs: number | null) {
    const prisma = bancoFalso([
      { id_device: 1, ultimo_poll_em: ultimoPollHaMs === null ? null : new Date(Date.now() - ultimoPollHaMs) },
    ]);
    // Instância recém-criada (boot do deploy): nada em memória, o timer de 5 s ainda não rodou.
    const bridge = new AgentBridgeService(prisma);
    pontes.push(bridge);
    const service: any = {
      resolveAgente: jest.fn(async () => ({ idCondominio: 7 })),
      getActiveDevices: jest.fn(async () => [F(1)]),
      findDeviceByToken: jest.fn(async () => F(1)),
      syncAllForCondominio: jest.fn(async () => ({ started: true })),
    };
    const descoberta: any = { consumirPedido: jest.fn(async () => false) };
    const ctrl = new AgentController(service, bridge, {} as any, descoberta);
    return { ctrl, service, bridge };
  }

  it('condoPoll: aparelho que fez poll na instância antiga há 5 s NÃO dispara back-fill', async () => {
    const { ctrl, service } = montar(5_000);
    await ctrl.condoPoll('tok');
    await assentar();
    expect(service.syncAllForCondominio).not.toHaveBeenCalled();
  });

  it('poll legado: mesmo caso, sem back-fill', async () => {
    const { ctrl, service } = montar(5_000);
    await ctrl.poll('tok-dev');
    await assentar();
    expect(service.syncAllForCondominio).not.toHaveBeenCalled();
  });

  it('condoPoll: último poll gravado mais velho que o TTL de online é reconexão de verdade', async () => {
    const { ctrl, service } = montar(10 * 60 * 1000);
    await ctrl.condoPoll('tok');
    await assentar();
    expect(service.syncAllForCondominio).toHaveBeenCalledTimes(1);
    expect(service.syncAllForCondominio).toHaveBeenCalledWith(7, { onlyPending: true });
  });

  it('condoPoll: aparelho que nunca fez poll também é reconexão', async () => {
    const { ctrl, service } = montar(null);
    await ctrl.condoPoll('tok');
    await assentar();
    expect(service.syncAllForCondominio).toHaveBeenCalledTimes(1);
  });

  it('back-fill que rejeita não vira unhandled rejection (condoPoll e poll legado)', async () => {
    const rejeicoes: unknown[] = [];
    const ouvir = (e: unknown) => rejeicoes.push(e);
    process.on('unhandledRejection', ouvir);
    try {
      const a = montar(10 * 60 * 1000);
      a.service.syncAllForCondominio.mockRejectedValue(new Error('banco caiu'));
      await a.ctrl.condoPoll('tok');
      const b = montar(10 * 60 * 1000);
      b.service.syncAllForCondominio.mockRejectedValue(new Error('banco caiu'));
      await b.ctrl.poll('tok-dev');
      await assentar();
      await new Promise((r) => setImmediate(r));
      expect(a.service.syncAllForCondominio).toHaveBeenCalled();
      expect(b.service.syncAllForCondominio).toHaveBeenCalled();
      expect(rejeicoes).toEqual([]);
    } finally {
      process.off('unhandledRejection', ouvir);
    }
  });

  it('várias rotas ao mesmo tempo no boot leem o banco uma vez só', async () => {
    const { ctrl, bridge } = montar(5_000);
    const prisma: any = (bridge as any).prisma;
    await Promise.all([ctrl.condoPoll('tok'), ctrl.condoPoll('tok'), ctrl.poll('tok-dev')]);
    expect(prisma.agente_Dispositivos_Estado.findMany).toHaveBeenCalledTimes(1);
  });
});
