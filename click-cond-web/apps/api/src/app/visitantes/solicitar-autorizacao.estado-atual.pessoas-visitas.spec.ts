import { VisitantesService } from './visitantes.service';

/**
 * Solicitar (portaria remota), caminho Pessoas/Visitas — rodada 3:
 *  - item 2: o pedido a uma unidade sem ninguém com app (ou com o aviso de
 *    visitantes desligado) respondia `{ ok: true }` e a tela dizia "o morador
 *    foi notificado". Agora a resposta diz quantos foram avisados.
 *  - item 4B: Solicitar a partir de uma lista desatualizada voltava para
 *    `pendente`/`liberado 0` uma visita que o morador acabou de autorizar, sem
 *    ressincronizar o terminal (que seguia abrindo). Agora: 409 quando a
 *    autorização ainda vale, e o terminal é ressincronizado sempre que o
 *    pedido zera a liberação.
 */
describe('solicitarAutorizacao (Pessoas/Visitas) — estado atual e avisados', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const H = 60 * 60 * 1000;
  const operador = { sub: 3, nome: 'QA', id_condominio: 1 } as any;

  function montar(
    extra: Record<string, unknown>,
    moradores: any[] = [],
    opts: { card?: boolean; vagaVigente?: any } = {},
  ) {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    const pessoa = { id: 2000001, nome: 'QA_Solicitar', bloqueado: 0, foto_pessoa: null };
    const visita: any = {
      id: 1000004,
      id_pessoa: 2000001,
      id_condominio: 1,
      id_apartamento: 106,
      is_prestador: 0,
      data_hora_inicio: new Date(Date.now() - H),
      data_hora_termino: new Date(Date.now() + 3 * H),
      data_entrada: null,
      data_saida: null,
      liberado: 0,
      bloqueado: 0,
      auth_status: null,
      created_at: new Date(Date.now() - 2 * H),
      ...extra,
    };
    const comRelacoes = (v: any) => ({ ...v, pessoa, apartamento: { bloco: 'A', apto: '106' } });
    const prisma: any = {
      isConnected: true,
      users: { findMany: jest.fn(async () => moradores) },
      vagas: { findFirst: jest.fn(async () => opts.vagaVigente ?? null) },
      visitas: {
        update: jest.fn(async ({ data }: any) => comRelacoes(Object.assign(visita, data))),
      },
    };
    const notifications = {
      sendPushNotification: jest.fn(async () => 'msg-id'),
      sendWhatsApp: jest.fn(async () => null),
    };
    const facial = { syncPessoa: jest.fn(async () => ({})) };
    const card = opts.card ? { abrir: jest.fn(async () => undefined) } : undefined;
    const svc = new VisitantesService(
      prisma, notifications as any, {} as any, facial as any, { registrar: jest.fn() } as any, {} as any,
      { emitToCondominio: jest.fn() } as any, undefined as any, card as any,
    );
    const s = svc as any;
    jest.spyOn(s, 'assertPodeAcessarVisita').mockImplementation(async () => comRelacoes(visita));
    return { svc, prisma, visita, facial, notifications, card };
  }

  describe('item 4B — pedido sobre autorização que ainda vale', () => {
    it('morador autorizou há pouco: 409 e a visita fica como está', async () => {
      const { svc, prisma, visita } = montar({
        auth_status: 'autorizado',
        liberado: 1,
        auth_solicitado_em: new Date(Date.now() - 2 * 60 * 1000),
        auth_respondido_em: new Date(Date.now() - 60 * 1000),
      });
      await expect(svc.solicitarAutorizacao(1000004, operador)).rejects.toMatchObject({ status: 409 });
      expect(prisma.visitas.update).not.toHaveBeenCalled();
      expect(visita.liberado).toBe(1);
    });

    it('autorização vencida (mais de 10 min): o pedido segue', async () => {
      const { svc, visita } = montar({
        auth_status: 'autorizado',
        liberado: 1,
        auth_solicitado_em: new Date(Date.now() - 40 * 60 * 1000),
        auth_respondido_em: new Date(Date.now() - 30 * 60 * 1000),
      });
      await svc.solicitarAutorizacao(1000004, operador);
      expect(visita.auth_status).toBe('pendente');
      expect(visita.liberado).toBe(0);
    });

    it('o pedido zera a liberação: o terminal é ressincronizado', async () => {
      const { svc, facial } = montar({ liberado: 1 });
      await svc.solicitarAutorizacao(1000004, operador);
      expect(facial.syncPessoa).toHaveBeenCalledWith(2000001);
    });
  });

  // Revisão M-3: a tela trata visita com vaga vigente como acesso contínuo
  // ("Liberado"); a API não pode derrubar essa liberação com um pedido.
  describe('vaga vigente', () => {
    it('visita usada que segue liberada pela vaga: 409, nada muda', async () => {
      const { svc, prisma, visita } = montar(
        { liberado: 1, data_entrada: new Date(Date.now() - 5 * H), data_saida: new Date(Date.now() - 4 * H) },
        [],
        { vagaVigente: { id: 9 } },
      );
      await expect(svc.solicitarAutorizacao(1000004, operador)).rejects.toMatchObject({ status: 409 });
      expect(prisma.visitas.update).not.toHaveBeenCalled();
      expect(visita.liberado).toBe(1);
    });

    it('vaga vencida (não vigente): o pedido segue', async () => {
      const { svc, visita } = montar({ liberado: 1 }, [], { vagaVigente: null });
      await svc.solicitarAutorizacao(1000004, operador);
      expect(visita.auth_status).toBe('pendente');
    });
  });

  describe('item 2 — quantos moradores foram avisados', () => {
    it('ninguém na unidade com app: avisados 0', async () => {
      const { svc } = montar({}, []);
      await expect(svc.solicitarAutorizacao(1000004, operador)).resolves.toEqual(
        expect.objectContaining({ ok: true, avisados: 0 }),
      );
    });

    it('push comum entregue a dois moradores: avisados 2', async () => {
      const { svc } = montar({}, [
        { id: 7, fcm_token: 'token-morador-7-xxxx', name: 'A', phone: null },
        { id: 8, fcm_token: 'token-morador-8-xxxx', name: 'B', phone: null },
      ]);
      await expect(svc.solicitarAutorizacao(1000004, operador)).resolves.toEqual(
        expect.objectContaining({ avisados: 2 }),
      );
    });

    it('push que não sai (Firebase desligado) não conta', async () => {
      const { svc, notifications } = montar({}, [{ id: 7, fcm_token: 'token-morador-7-xxxx', name: 'A', phone: null }]);
      notifications.sendPushNotification.mockResolvedValue(null as any);
      await expect(svc.solicitarAutorizacao(1000004, operador)).resolves.toEqual(
        expect.objectContaining({ avisados: 0 }),
      );
    });

    it('card ao vivo aberto: conta os moradores do card', async () => {
      const { svc, card } = montar({}, [{ id: 7, fcm_token: 'token-morador-7-xxxx', name: 'A', phone: null }], { card: true });
      await expect(svc.solicitarAutorizacao(1000004, operador)).resolves.toEqual(
        expect.objectContaining({ avisados: 1 }),
      );
      expect(card!.abrir).toHaveBeenCalled();
    });
  });
});
