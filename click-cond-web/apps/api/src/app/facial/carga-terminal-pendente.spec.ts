/**
 * Carga automática do terminal facial novo (revisão 11/11).
 *
 * No instante do cadastro o terminal nunca está online (o heartbeat por device
 * só chega no próximo poll do agente): a carga falhava para todos e rebaixava
 * o `face_sync_status` GLOBAL das pessoas de `synced` para `pending` — embora
 * continuassem válidas no 1º terminal — e, quando o agente voltava, todo mundo
 * era recarregado em todos os terminais.
 *
 * Agora: terminal offline fica com "carga pendente" (`ultima_sincr = null` em
 * Facial_Devices, que sobrevive a múltiplas instâncias); a reconexão dispara a
 * carga completa SÓ dele; e falha numa carga restrita não rebaixa quem já
 * está `synced`.
 *
 * Mocks, sem banco e sem aparelho.
 */
import { AgentController } from './agent.controller';

let FacialService: any;

describe('carga pendente do terminal facial', () => {
  beforeAll(() => {
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    delete process.env.PESSOAS_MIGRATION_ENABLED;
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });

  const assentar = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };

  // ------------------------------------------------------------------ (c)
  describe('falha numa carga restrita não rebaixa quem já está synced', () => {
    const TERMINAL_2 = { id: 2, id_condominio: 1, ativo: 1, tipo: 'facial', fabricante: 'intelbras' };

    function build(morador: any, opts: { falha?: string | null } = {}) {
      const prisma: any = {
        isConnected: true,
        moradores: {
          findUnique: jest.fn(async () => morador),
          update: jest.fn(async () => ({})),
        },
        pessoas: { update: jest.fn(async () => ({})) },
        facial_Devices: {
          findMany: jest.fn(async () => [TERMINAL_2]),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
      };
      const falhar = async () => {
        if (opts.falha) throw new Error(opts.falha);
        return { faceId: 'morador_11' };
      };
      const client: any = {
        updatePerson: jest.fn(falhar),
        enrollPerson: jest.fn(falhar),
        removePerson: jest.fn(async () => undefined),
      };
      const svc = new FacialService(
        prisma,
        client,
        null as any,
        null as any,
        { registrar: jest.fn() } as any,
        null as any,
        { isOnline: jest.fn(() => true) } as any,
        null as any,
        { autorizouBiometria: jest.fn(async () => true) } as any,
        null as any,
      );
      jest.spyOn(svc as any, 'fetchPhotoAsBase64').mockResolvedValue('Zm90bw==');
      jest.spyOn(svc as any, 'gatedAreaDeviceIds').mockResolvedValue(new Set());
      jest.spyOn(svc as any, 'categoriasPermitidasNoDispositivo').mockResolvedValue(null);
      jest.spyOn(svc as any, 'categoriaAutorizada').mockReturnValue(true);
      jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
      return { svc, prisma, client };
    }
    const ANA = (extra: any = {}) => ({
      id: 11,
      nome: 'Ana',
      tipo: 'morador',
      id_condominio: 1,
      id_user: 5,
      data_nascimento: new Date('1990-01-01'),
      foto_pessoa: 'https://x/ana.jpg',
      face_id: 'morador_11',
      face_sync_status: 'synced',
      face_enrolled_at: new Date('2026-01-01'),
      ...extra,
    });
    const OFFLINE = 'Agente local offline';

    it('morador synced + falha no terminal novo (carga restrita): status global NÃO é tocado', async () => {
      const { svc, prisma } = build(ANA(), { falha: OFFLINE });

      const r = await svc.syncMorador(11, { deviceIds: [2], cargaRestrita: true });

      expect(r.ok).toBe(false);
      expect(prisma.moradores.update).not.toHaveBeenCalled();
    });

    it('fora da carga restrita o comportamento antigo continua: falha rebaixa o status', async () => {
      const { svc, prisma } = build(ANA(), { falha: OFFLINE });

      await svc.syncMorador(11);

      const data = prisma.moradores.update.mock.calls[0][0].data;
      expect(data.face_sync_status).not.toBe('synced');
    });

    it('carga restrita: quem NÃO estava synced continua tendo a falha gravada', async () => {
      const { svc, prisma } = build(ANA({ face_sync_status: 'pending' }), { falha: OFFLINE });

      await svc.syncMorador(11, { deviceIds: [2], cargaRestrita: true });

      expect(prisma.moradores.update).toHaveBeenCalledTimes(1);
      expect(prisma.moradores.update.mock.calls[0][0].data.face_sync_status).not.toBe('synced');
    });

    it('carga restrita com sucesso grava synced normalmente', async () => {
      const { svc, prisma } = build(ANA());

      const r = await svc.syncMorador(11, { deviceIds: [2], cargaRestrita: true });

      expect(r.ok).toBe(true);
      expect(prisma.moradores.update.mock.calls[0][0].data.face_sync_status).toBe('synced');
    });

    it('pessoa (Pessoas/Visitas) synced + falha em carga restrita: status global NÃO é tocado', async () => {
      const { svc, prisma } = build(ANA(), { falha: OFFLINE });
      const pessoa = {
        id: 7,
        nome: 'Vítor',
        id_condominio: 1,
        foto_pessoa: 'https://x/v.jpg',
        face_id: 'pessoa_7',
        face_sync_status: 'synced',
        tipo_pessoa: 'visitante',
        visitas: [],
      };
      jest.spyOn(svc as any, 'resolverVisitaAtivaPessoa').mockReturnValue({
        liberado: 1,
        data_entrada: null,
        data_saida: null,
        data_hora_inicio: null,
        data_hora_termino: null,
        dias_semana: null,
        is_prestador: 1,
      });

      const r: any = await svc.pushPessoaToDevices(pessoa, { deviceIds: [2], cargaRestrita: true });

      expect(r.ok).toBe(false);
      expect(prisma.pessoas.update).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------- carga em massa restrita
  describe('syncAllForCondominio restrito a deviceIds', () => {
    function build(resultados: Record<string, any>) {
      const prisma: any = {
        isConnected: true,
        facial_Devices: {
          findMany: jest.fn(async () => [{ id: 1 }, { id: 2 }]),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        moradores: { findMany: jest.fn(async () => [{ id: 11 }, { id: 12 }]) },
        visitantes: { findMany: jest.fn(async () => [{ id: 30 }]) },
        prestadores_servico: { findMany: jest.fn(async () => [{ id: 40 }]) },
      };
      const svc = new FacialService(
        prisma, {} as any, null as any, null as any, { registrar: jest.fn() } as any,
        null as any, { isOnline: jest.fn(() => true) } as any,
      );
      const ok = { ok: true, status: 'synced' };
      const syncMorador = jest
        .spyOn(svc, 'syncMorador')
        .mockImplementation(async (id: number) => resultados[`m${id}`] ?? ok);
      const syncVisitante = jest.spyOn(svc, 'syncVisitante').mockResolvedValue(ok as any);
      const syncPrestador = jest.spyOn(svc, 'syncPrestadorServico').mockResolvedValue(ok as any);
      return { svc, prisma, syncMorador, syncVisitante, syncPrestador };
    }
    const terminou = async (svc: any) => {
      for (let i = 0; i < 200 && (await svc.estado.obter('facial:bulk:1')); i++) {
        await new Promise((r) => setImmediate(r));
      }
      await assentar();
    };

    it('repassa `cargaRestrita` para cada pessoa', async () => {
      const { svc, syncMorador, syncVisitante, syncPrestador } = build({});

      await svc.syncAllForCondominio(1, { deviceIds: [2] });
      await terminou(svc);

      const esperado = { deviceIds: [2], cargaRestrita: true };
      expect(syncMorador).toHaveBeenCalledWith(11, esperado);
      expect(syncVisitante).toHaveBeenCalledWith(30, esperado);
      expect(syncPrestador).toHaveBeenCalledWith(40, esperado);
    });

    it('sem deviceIds NÃO é carga restrita (comportamento antigo)', async () => {
      const { svc, prisma, syncMorador } = build({});

      await svc.syncAllForCondominio(1, { onlyPending: true });
      await terminou(svc);

      expect(syncMorador).toHaveBeenCalledWith(11, { deviceIds: undefined });
      expect(prisma.facial_Devices.updateMany).not.toHaveBeenCalled();
    });

    it('carga concluída sem falha transitória: tira o terminal de "pendente" (só se ainda estiver null)', async () => {
      const { svc, prisma } = build({});

      await svc.syncAllForCondominio(1, { deviceIds: [2] });
      await terminou(svc);

      expect(prisma.facial_Devices.updateMany).toHaveBeenCalledTimes(1);
      const arg = prisma.facial_Devices.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: { in: [2] }, ultima_sincr: null });
      expect(arg.data.ultima_sincr).toBeInstanceOf(Date);
    });

    it('falha TRANSITÓRIA (agente caiu no meio): o terminal volta a "carga pendente"', async () => {
      const { svc, prisma } = build({ m12: { ok: false, status: 'pending', error: 'Agente local offline' } });

      await svc.syncAllForCondominio(1, { deviceIds: [2] });
      await terminou(svc);

      expect(prisma.facial_Devices.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.facial_Devices.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [2] } },
        data: { ultima_sincr: null },
      });
    });

    it('foto recusada (erro permanente da pessoa) NÃO deixa o terminal pendente para sempre', async () => {
      const { svc, prisma } = build({ m12: { ok: false, status: 'error', error: 'sem rosto' } });

      await svc.syncAllForCondominio(1, { deviceIds: [2] });
      await terminou(svc);

      expect(prisma.facial_Devices.updateMany.mock.calls[0][0].data.ultima_sincr).toBeInstanceOf(Date);
    });
  });

  // ------------------------------------------------------------- retentativa
  describe('tickSyncRetry: terminal online com carga pendente', () => {
    function build(devices: any[], online: number[]) {
      const prisma: any = {
        isConnected: true,
        facial_Devices: { findMany: jest.fn(async () => devices) },
      };
      const svc = new FacialService(
        prisma, {} as any, null as any, null as any, { registrar: jest.fn() } as any,
        null as any, { isOnline: jest.fn((id: number) => online.includes(id)) } as any,
      );
      const carga = jest.spyOn(svc, 'syncAllForCondominio').mockResolvedValue({ started: true, total: 1 } as any);
      return { svc, carga };
    }
    const D = (id: number, ultima_sincr: Date | null) => ({ id, id_condominio: 1, ultima_sincr });

    it('sem terminal pendente: só o back-fill onlyPending, como antes', async () => {
      const { svc, carga } = build([D(1, new Date()), D(2, new Date())], [1, 2]);

      await (svc as any).tickSyncRetry();

      expect(carga).toHaveBeenCalledTimes(1);
      expect(carga).toHaveBeenCalledWith(1, { onlyPending: true });
    });

    it('terminal pendente e ONLINE: alterna carga restrita e onlyPending (um não deixa o outro sem rodar)', async () => {
      const { svc, carga } = build([D(1, new Date()), D(2, null)], [1, 2]);

      await (svc as any).tickSyncRetry();
      await (svc as any).tickSyncRetry();
      await (svc as any).tickSyncRetry();

      expect(carga.mock.calls.map((c: any[]) => c[1])).toEqual([
        { deviceIds: [2] },
        { onlyPending: true },
        { deviceIds: [2] },
      ]);
    });

    it('terminal pendente mas OFFLINE não recebe carga (espera a reconexão)', async () => {
      const { svc, carga } = build([D(1, new Date()), D(2, null)], [1]);

      await (svc as any).tickSyncRetry();

      expect(carga).toHaveBeenCalledTimes(1);
      expect(carga).toHaveBeenCalledWith(1, { onlyPending: true });
    });
  });

  // ------------------------------------------------- (b) gancho de reconexão
  describe('reconexão do agente (AgentController)', () => {
    function montar(devices: any[], online: number[] = []) {
      const service: any = {
        resolveCondominioForAgent: jest.fn(async () => 7),
        getActiveDevices: jest.fn(async () => devices),
        findDeviceByToken: jest.fn(async () => devices[0]),
        syncAllForCondominio: jest.fn(async () => ({ started: true })),
      };
      const bridge: any = {
        isOnline: jest.fn((id: number) => online.includes(id)),
        pollVarios: jest.fn(async () => new Map()),
        poll: jest.fn(async () => []),
        pollIntervalMs: 2000,
      };
      const descoberta: any = { consumirPedido: jest.fn(async () => false) };
      return { ctrl: new AgentController(service, bridge, {} as any, descoberta), service };
    }
    const F = (id: number, ultima_sincr: Date | null, tipo = 'facial') => ({
      id, tipo, fabricante: 'intelbras', id_condominio: 7, ultima_sincr,
    });

    it('condoPoll: facial reconectado COM carga pendente recebe a carga completa restrita a ele', async () => {
      const { ctrl, service } = montar([F(1, new Date()), F(2, null)], [1]);

      await ctrl.condoPoll('tok');
      await assentar();

      expect(service.syncAllForCondominio).toHaveBeenCalledTimes(1);
      expect(service.syncAllForCondominio).toHaveBeenCalledWith(7, { deviceIds: [2] });
    });

    it('condoPoll: facial reconectado SEM carga pendente mantém o back-fill onlyPending', async () => {
      const { ctrl, service } = montar([F(1, new Date()), F(2, new Date())], [1]);

      await ctrl.condoPoll('tok');
      await assentar();

      expect(service.syncAllForCondominio).toHaveBeenCalledTimes(1);
      expect(service.syncAllForCondominio).toHaveBeenCalledWith(7, { onlyPending: true });
    });

    it('condoPoll: pendente + outro reconectado: primeiro a carga restrita, depois o onlyPending', async () => {
      const { ctrl, service } = montar([F(1, new Date()), F(2, null)], []);

      await ctrl.condoPoll('tok');
      await assentar();

      expect(service.syncAllForCondominio.mock.calls).toEqual([
        [7, { deviceIds: [2] }],
        [7, { onlyPending: true }],
      ]);
    });

    it('condoPoll: terminal pendente que JÁ estava online não dispara nada (não é reconexão)', async () => {
      const { ctrl, service } = montar([F(2, null)], [2]);

      await ctrl.condoPoll('tok');
      await assentar();

      expect(service.syncAllForCondominio).not.toHaveBeenCalled();
    });

    it('condoPoll: leitor de tag com ultima_sincr null não é "carga pendente"', async () => {
      const { ctrl, service } = montar([F(3, null, 'tag_reader')], []);

      await ctrl.condoPoll('tok');
      await assentar();

      expect(service.syncAllForCondominio).not.toHaveBeenCalled();
    });

    it('poll por dispositivo: mesma regra', async () => {
      const pendente = montar([F(2, null)], []);
      await pendente.ctrl.poll('tok');
      expect(pendente.service.syncAllForCondominio).toHaveBeenCalledWith(7, { deviceIds: [2] });

      const emDia = montar([F(2, new Date())], []);
      await emDia.ctrl.poll('tok');
      expect(emDia.service.syncAllForCondominio).toHaveBeenCalledWith(7, { onlyPending: true });
    });
  });
});
