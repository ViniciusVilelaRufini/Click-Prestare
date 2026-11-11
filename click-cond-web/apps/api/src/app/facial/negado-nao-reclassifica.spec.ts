/**
 * Negação informada pelo PRÓPRIO aparelho nunca é reclassificada.
 *
 * Num terminal em `auto` sem direção no payload, o `runWebhook` alterna a
 * direção (facial: pelo último acesso; visitante em leitor: pelo estado da
 * visita). Um evento que o aparelho já reportou como negado (`event` com
 * "denied"/"negado") de pessoa CONHECIDA caía nessa alternância e era gravado
 * como entrada/saída — acesso que não aconteceu, e baixa indevida na visita.
 *
 * Com a guarda `evento !== 'negado'`, o evento segue `negado`: é gravado como
 * tal (com a pessoa identificada), o webhook responde normalmente (não lança)
 * com `evento: 'negado'`, nada é aberto e a visita não muda.
 *
 * Mocks, sem banco e sem aparelho (mesma montagem de leitor-sem-direcao.spec).
 */
let FacialService: any;

describe('FacialService — negado do aparelho não é reclassificado pela alternância', () => {
  beforeAll(() => {
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => {
    delete process.env.PESSOAS_MIGRATION_ENABLED;
  });

  const ANA = { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 1, tag_rfid: 'ABC999', qrcode_acesso: 'QR-ANA' };
  const PORTAO = { id: 20, id_condominio: 1, tipo: 'botoeira', ativo: 1, nome: 'Portão' };
  const dispositivo = (tipo: string, sentido: string) => ({
    id: 42,
    id_condominio: 1,
    tipo,
    sentido,
    ativo: 1,
    confianca_minima: 0,
    id_area_social: null,
    nome: `Aparelho ${tipo}`,
    webhook_token: 'tok',
  });

  const casa = (filtro: any, valor: string | null) => {
    if (filtro === undefined) return true;
    if (valor == null) return false;
    return typeof filtro === 'string' ? filtro === valor : filtro.in.includes(valor);
  };

  /** `acessos` é o histórico: o que o webhook grava vira o "último acesso". */
  function build(device: any, opts: { visitante?: any } = {}) {
    const acessos: any[] = [];
    const vis = opts.visitante ?? null;
    const visitantesPor = ({ where }: any) =>
      vis &&
      (where?.id === undefined || where.id === vis.id) &&
      (where?.tag_rfid === undefined || casa(where.tag_rfid, vis.tag_rfid)) &&
      (where?.codigo_acesso === undefined || where.codigo_acesso === vis.codigo_acesso)
        ? [vis]
        : [];
    const filtraMoradores = ({ where }: any) =>
      [ANA].filter(
        (m) =>
          (where.id === undefined || where.id === m.id) &&
          (where.tag_rfid === undefined || casa(where.tag_rfid, m.tag_rfid)) &&
          (where.qrcode_acesso === undefined || where.qrcode_acesso === m.qrcode_acesso) &&
          (where.face_id === undefined || false),
      );
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => device),
        findMany: jest.fn(async () => [PORTAO]),
      },
      moradores: {
        findFirst: jest.fn(async (args: any) => filtraMoradores(args)[0] ?? null),
        findMany: jest.fn(async (args: any) => filtraMoradores(args)),
        findUnique: jest.fn(async ({ where }: any) => (where.id === ANA.id ? ANA : null)),
      },
      tags: { findMany: jest.fn(async () => []) },
      visitantes: {
        findMany: jest.fn(async (args: any) => visitantesPor(args)),
        findFirst: jest.fn(async (args: any) => visitantesPor(args)[0] ?? null),
        findUnique: jest.fn(async (args: any) => visitantesPor(args)[0] ?? null),
        updateMany: jest.fn(async ({ data }: any) => {
          if (!vis) return { count: 0 };
          Object.assign(vis, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => Object.assign(vis ?? {}, data)),
      },
      veiculos: { findMany: jest.fn(async () => []) },
      vagas: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
      acessos_Facial: {
        create: jest.fn(async ({ data }: any) => {
          acessos.push(data);
          return { id: acessos.length };
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const eventos: string[] | undefined = where?.evento?.in;
          const achados = acessos.filter(
            (a) =>
              (!eventos || eventos.includes(a.evento)) &&
              (where?.id_pessoa === undefined || a.id_pessoa === where.id_pessoa),
          );
          return achados[achados.length - 1] ?? null;
        }),
      },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      users: { findMany: jest.fn(async () => []) },
    };
    const client: any = { triggerRelay: jest.fn(async () => ({ ok: true })) };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => 'allow'),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const notifications: any = { sendPushNotification: jest.fn() };
    const svc = new FacialService(
      prisma,
      client,
      notifications,
      { consumeForDevice: jest.fn(() => null) } as any,
      { registrar: jest.fn() } as any,
      accessState,
      {} as any,
    );
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    const syncVisitante = jest.spyOn(svc as any, 'syncVisitante').mockResolvedValue(undefined);
    return { svc, prisma, client, acessos, accessState, notifications, syncVisitante };
  }

  const TS = ['2026-07-20T10:00:00.000Z', '2026-07-20T18:00:00.000Z'];
  const rosto = (i: number, extra: any = {}) => ({ external_id: 'morador_11', timestamp: TS[i], ...extra });

  const visitante = (extra: any = {}) => ({
    id: 30,
    nome: 'Vítor',
    id_condominio: 1,
    id_apartamento: 101,
    is_prestador: 0,
    liberado: 1,
    bloqueado: 0,
    tag_rfid: 'VIS777',
    codigo_acesso: 'QR-VIS',
    data_hora_inicio: new Date('2026-07-19T00:00:00.000Z'),
    data_hora_termino: new Date('2026-07-25T00:00:00.000Z'),
    data_entrada: null as Date | null,
    data_saida: null as Date | null,
    dias_semana: null,
    ...extra,
  });

  it('facial em "auto": negado do aparelho para morador conhecido é gravado como negado, não como entrada', async () => {
    const { svc, client, acessos, accessState } = build(dispositivo('facial', 'auto'));

    const res = await svc.processWebhook('tok', rosto(0, { event: 'access_denied' }));

    // Comportamento real: não lança; responde com o evento negado.
    expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'morador', id: 11, evento: 'negado' }));
    expect(acessos.map((a) => a.evento)).toEqual(['negado']);
    expect(acessos[0]).toEqual(
      expect.objectContaining({ tipo_pessoa: 'morador', id_pessoa: 11, nome_pessoa: 'Ana', evento: 'negado' }),
    );
    expect(acessos.some((a) => a.evento === 'entrada' || a.evento === 'saida')).toBe(false);
    // Negado não mexe no estado de presença nem abre nada.
    expect(accessState.checkAntiPassback).not.toHaveBeenCalled();
    expect(accessState.setPresenca).not.toHaveBeenCalled();
    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('facial em "auto": com o último acesso sendo entrada, o negado não vira saída', async () => {
    const { svc, client, acessos } = build(dispositivo('facial', 'auto'));
    acessos.push({ evento: 'entrada', id_pessoa: 11, tipo_pessoa: 'morador' });

    const res = await svc.processWebhook('tok', rosto(1, { event: 'access_denied' }));

    expect(res.evento).toBe('negado');
    expect(acessos.map((a) => a.evento)).toEqual(['entrada', 'negado']);
    expect(acessos[1]).toEqual(expect.objectContaining({ tipo_pessoa: 'morador', id_pessoa: 11, evento: 'negado' }));
    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('tag_reader em "auto": negado do aparelho para visitante DENTRO não vira saída (não dá baixa)', async () => {
    const entrada = new Date('2026-07-20T08:00:00.000Z');
    const vis = visitante({ data_entrada: entrada });
    const { svc, prisma, client, acessos, notifications, syncVisitante } = build(dispositivo('tag_reader', 'auto'), {
      visitante: vis,
    });

    const res = await svc.processWebhook('tok', {
      card_uid: 'VIS777',
      event: 'access_denied',
      timestamp: TS[0],
    });

    expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'visitante', id: 30, evento: 'negado' }));
    expect(acessos.map((a) => a.evento)).toEqual(['negado']);
    expect(acessos[0]).toEqual(expect.objectContaining({ tipo_pessoa: 'visitante', id_pessoa: 30, evento: 'negado' }));
    // A visita fica intacta: segue DENTRO e liberada.
    expect(prisma.visitantes.updateMany).not.toHaveBeenCalled();
    expect(prisma.visitantes.update).not.toHaveBeenCalled();
    expect(vis.data_entrada).toEqual(entrada);
    expect(vis.data_saida).toBeNull();
    expect(vis.liberado).toBe(1);
    expect(syncVisitante).not.toHaveBeenCalled();
    expect(notifications.sendPushNotification).not.toHaveBeenCalled();
    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('controle — facial em "auto" com evento normal continua alternando entrada → saída', async () => {
    const { svc, acessos } = build(dispositivo('facial', 'auto'));

    const r1 = await svc.processWebhook('tok', rosto(0, { event: 'recognized' }));
    const r2 = await svc.processWebhook('tok', rosto(1, { event: 'recognized' }));

    expect([r1.evento, r2.evento]).toEqual(['entrada', 'saida']);
    expect(acessos.map((a) => a.evento)).toEqual(['entrada', 'saida']);
  });
});
