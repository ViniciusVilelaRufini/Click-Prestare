/**
 * Rodada 4, item 3b: a pessoa com mais de uma visita viva. A escolha era "a
 * primeira que o banco devolver" (`.find` sem `orderBy` no rosto; id mais alto
 * na tag): a entrada caía na visita de outra unidade, o aviso "chegou" ia para
 * o morador errado e a liberação certa ficava sem uso.
 *
 * Cenário do revisor: o 202 pré-autorizou o João para hoje; a portaria libera
 * o João no 101; ele entra pelo rosto → a entrada cai na visita do 101, o
 * aviso vai para o 101 e a pré-autorização do 202 fica intacta.
 */
let FacialService: any;

const MIN = 60 * 1000;
const HORA = 60 * MIN;

describe('FacialService — várias visitas vivas: desempate determinístico', () => {
  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => {
    jest.useRealTimers();
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });

  const ID_PESSOA = 2000300;
  const pessoaRef = { id: ID_PESSOA, nome: 'João', bloqueado: 0 };

  /** Pré-autorização do morador do 202, criada hoje às 8h (id mais alto: visita mais nova). */
  function visita202(extra: Record<string, unknown> = {}) {
    const agora = Date.now();
    return {
      id: 1000200, id_pessoa: ID_PESSOA, id_condominio: 1, id_apartamento: 202, user: 2020,
      is_visitante: 1, is_prestador: 0, liberado: 1, bloqueado: 0,
      codigo_acesso: '202202', tag_rfid: 'TAG-JOAO', dias_semana: null,
      data_hora_inicio: new Date(agora - 6 * HORA), data_hora_termino: new Date(agora + 10 * HORA),
      data_entrada: null, data_saida: null,
      auth_status: null, auth_solicitado_em: null, auth_respondido_em: null, auth_respondido_por: null,
      created_at: new Date(agora - 6 * HORA), updated_at: new Date(agora - 6 * HORA),
      pessoa: pessoaRef,
      ...extra,
    };
  }
  /** Visita antiga do 101 (id mais baixo) que a portaria acabou de liberar (Liberar regrava a linha). */
  function visita101(extra: Record<string, unknown> = {}) {
    const agora = Date.now();
    return {
      id: 1000150, id_pessoa: ID_PESSOA, id_condominio: 1, id_apartamento: 101, user: null,
      is_visitante: 1, is_prestador: 0, liberado: 1, bloqueado: 0,
      codigo_acesso: null, tag_rfid: 'TAG-JOAO', dias_semana: null,
      data_hora_inicio: new Date(agora - 5 * MIN), data_hora_termino: new Date(agora + 4 * HORA),
      data_entrada: null, data_saida: null,
      auth_status: null, auth_solicitado_em: null, auth_respondido_em: null, auth_respondido_por: null,
      created_at: new Date(agora - 30 * HORA), updated_at: new Date(agora - 2 * MIN),
      pessoa: pessoaRef,
      ...extra,
    };
  }

  const DEVICE_ENTRADA = {
    id: 3, id_condominio: 1, tipo: 'facial', sentido: 'entrada', ativo: 1,
    confianca_minima: 0, nome: 'Facial entrada', webhook_token: 'tok-entrada',
  };
  const DEVICE_SAIDA = { ...DEVICE_ENTRADA, id: 4, sentido: 'saida', nome: 'Facial saída', webhook_token: 'tok-saida' };
  const DEVICE_TAG = { ...DEVICE_ENTRADA, id: 5, tipo: 'tag_reader', nome: 'Antena', webhook_token: 'tok-tag' };
  const DEVICE_FACIAL = {
    id: 900, id_condominio: 1, ip: '10.0.0.5', porta: 80, api_user: 'admin', api_password: 'admin',
    fabricante: 'intelbras', ativo: 1, tipo: 'facial', sentido: 'entrada',
  };

  function montar(visitas: any[], device: any = DEVICE_ENTRADA) {
    const pessoa = {
      id: ID_PESSOA, id_condominio: 1, nome: 'João', tipo_pessoa: 'visitante',
      foto_pessoa: 'http://foto.jpg', face_id: 'face_joao', face_sync_status: 'synced', bloqueado: 0,
      visitas,
    };
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => device),
        findMany: jest.fn(async () => [DEVICE_FACIAL]),
      },
      moradores: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      tags: { findMany: jest.fn(async () => []) },
      visitantes: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null) },
      visitas: {
        findMany: jest.fn(async () => visitas),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      pessoas: {
        findFirst: jest.fn(async () => pessoa),
        findUnique: jest.fn(async () => pessoa),
        update: jest.fn(async () => pessoa),
      },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      acessos_Facial: { create: jest.fn(async () => ({ id: 1 })), findFirst: jest.fn(async () => null) },
      vagas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      users: { findMany: jest.fn(async () => [{ fcm_token: 'tok-morador' }]) },
    };
    const client = {
      enrollPerson: jest.fn(async () => ({ faceId: 'face_joao' })),
      updatePerson: jest.fn(async () => undefined),
      removePerson: jest.fn(async () => undefined),
    };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const notifications = { sendPushNotification: jest.fn(async () => undefined) };
    const svc = new FacialService(
      prisma, client as any, notifications as any,
      { consumeForDevice: jest.fn(() => null) } as any, { registrar: jest.fn() } as any,
      accessState, {} as any, { assertCondominio: jest.fn() } as any,
      { autorizouBiometria: jest.fn(async () => true) } as any,
      { autorizouBiometria: jest.fn(async () => true) } as any,
    );
    jest.spyOn(svc as any, 'fetchPhotoAsBase64').mockResolvedValue('BASE64');
    return { svc, prisma, client };
  }

  const idsTocados = (prisma: any) => [
    ...prisma.visitas.updateMany.mock.calls.map((c: any[]) => c[0].where.id),
    ...prisma.visitas.update.mock.calls.map((c: any[]) => c[0].where.id),
  ];

  it('rosto na ENTRADA: cai na visita do 101 (liberada agora), o aviso vai para o 101 e a do 202 fica intacta', async () => {
    const a202 = visita202();
    const b101 = visita101();
    const { svc, prisma } = montar([a202, b101]);
    await svc.processWebhook('tok-entrada', {
      event: 'entrada', direction: 'in', external_id: `pessoa_${ID_PESSOA}`, timestamp: new Date().toISOString(),
    });
    expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: b101.id }), data: expect.objectContaining({ data_entrada: expect.any(Date) }) }),
    );
    expect(idsTocados(prisma)).not.toContain(a202.id);
    const filtro = prisma.users.findMany.mock.calls[0][0].where.apartamentosUsers.some;
    expect(filtro.id_apto).toBe(101);
    expect(a202.liberado).toBe(1);
    expect(a202.codigo_acesso).toBe('202202');
  });

  it('tag compartilhada pelas duas visitas: a ENTRADA vai para a liberada mais recentemente (101)', async () => {
    const a202 = visita202();
    const b101 = visita101();
    const { svc, prisma } = montar([a202, b101], DEVICE_TAG);
    await svc.processWebhook('tok-tag', { event: 'entrada', external_id: 'TAG-JOAO', timestamp: new Date().toISOString() });
    expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: b101.id }) }),
    );
    expect(idsTocados(prisma)).not.toContain(a202.id);
  });

  it('rosto na SAÍDA: baixa na visita em que a pessoa está dentro, não na outra liberada', async () => {
    const a202 = visita202({ data_entrada: new Date(Date.now() - HORA) });
    const b101 = visita101();
    // A visita "pronta" vem primeiro do banco.
    const { svc, prisma } = montar([b101, a202], DEVICE_SAIDA);
    await svc.processWebhook('tok-saida', {
      event: 'saida', direction: 'out', external_id: `pessoa_${ID_PESSOA}`, timestamp: new Date().toISOString(),
    });
    expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: a202.id }), data: expect.objectContaining({ data_saida: expect.any(Date) }) }),
    );
    expect(idsTocados(prisma)).not.toContain(b101.id);
  });

  it('empate de datas: vence o id mais alto, seja qual for a ordem do banco', async () => {
    const agora = Date.now();
    const mesmo = { created_at: new Date(agora - HORA), updated_at: new Date(agora - HORA) };
    const x = visita101({ id: 1000400, id_apartamento: 303, ...mesmo });
    const y = visita101({ id: 1000500, id_apartamento: 404, ...mesmo });
    for (const ordem of [[x, y], [y, x]]) {
      const { svc, prisma } = montar(ordem);
      await svc.processWebhook('tok-entrada', {
        event: 'entrada', direction: 'in', external_id: `pessoa_${ID_PESSOA}`, timestamp: new Date().toISOString(),
      });
      expect(prisma.visitas.updateMany.mock.calls[0][0].where.id).toBe(1000500);
    }
  });

  // ------------------------------------------------------------------ Rodada 1
  // I-1: nada de união — janela, usos, categoria e teto do dia vêm INTEIROS de
  // UMA visita (a escolhida). Somar direitos alargava o acesso offline.
  describe('o aparelho recebe UMA visita, inteira', () => {
    const DIA = '2026-11-16'; // segunda-feira
    const z = (hhmm: string) => new Date(`${DIA}T${hhmm}:00Z`); // BRT = Z - 3h

    function cenarioPrestadorEAvulsa() {
      // Prestador 08–10h BRT, liberado por último (a escolhida); avulsa de 1 uso 08–20h BRT.
      const prestador = visita101({
        id: 1000601, id_apartamento: 101, is_prestador: 1, is_visitante: 0,
        data_hora_inicio: z('11:00'), data_hora_termino: z('13:00'),
        created_at: z('11:00'), updated_at: z('11:30'),
      });
      const avulsa = visita202({
        id: 1000600, id_apartamento: 202, is_prestador: 0,
        data_hora_inicio: z('11:00'), data_hora_termino: z('23:00'),
        created_at: z('11:05'), updated_at: z('11:05'),
      });
      return { prestador, avulsa };
    }

    it('prestador 08–10 + avulsa 08–20: ValidTo 10h, usos ilimitados e categoria do prestador', async () => {
      jest.setSystemTime(z('12:00')); // 09:00 BRT
      const { prestador, avulsa } = cenarioPrestadorEAvulsa();
      const { svc, client } = montar([avulsa, prestador]);
      const categoria = jest.spyOn(svc as any, 'categoriaAutorizada');
      await svc.syncPessoa(ID_PESSOA);
      const fmt = (d: Date) => (svc as any).formatDahuaTime(d);
      expect(client.updatePerson).toHaveBeenCalledWith(
        expect.anything(), 'face_joao',
        expect.objectContaining({ validFrom: fmt(prestador.data_hora_inicio), validTo: fmt(prestador.data_hora_termino), userTimes: -1 }),
      );
      expect(categoria.mock.calls[0][1]).toBe('prestador');
    });

    it('depois das 10h15 o tick pega a pessoa e reenvia a avulsa: 1 uso, categoria visitante, ValidTo 20h', async () => {
      jest.setSystemTime(z('13:16')); // 10:16 BRT
      const { prestador, avulsa } = cenarioPrestadorEAvulsa();
      const { svc, client, prisma } = montar([avulsa, prestador]);
      // O tick seleciona a pessoa pela visita que venceu nas últimas 2 h.
      prisma.visitantes.findMany = jest.fn(async () => []);
      prisma.pessoas.findMany = jest.fn(async () => [{ id: ID_PESSOA }]);
      const sincronizar = jest.spyOn(svc as any, 'sincronizarPessoasDoTick').mockImplementation(() => undefined);
      await (svc as any).tickExpiracaoAutomatica();
      const where = prisma.pessoas.findMany.mock.calls[0][0].where;
      const termino = where.AND[2].OR[0].visitas.some.data_hora_termino;
      expect(prestador.data_hora_termino.getTime()).toBeGreaterThanOrEqual(termino.gte.getTime());
      expect(prestador.data_hora_termino.getTime()).toBeLessThan(termino.lt.getTime());
      expect(sincronizar).toHaveBeenCalledWith('tickExpiracaoAutomatica', [{ id: ID_PESSOA }], expect.any(String));

      const categoria = jest.spyOn(svc as any, 'categoriaAutorizada');
      await svc.syncPessoa(ID_PESSOA);
      const fmt = (d: Date) => (svc as any).formatDahuaTime(d);
      expect(client.updatePerson).toHaveBeenCalledWith(
        expect.anything(), 'face_joao',
        expect.objectContaining({ validTo: fmt(avulsa.data_hora_termino), userTimes: 1 }),
      );
      expect(categoria.mock.calls[0][1]).toBe('visitante');
    });

    it('recorrente + pessoa dentro por outra visita: vai a janela de quem está dentro, não a do recorrente', async () => {
      jest.setSystemTime(z('15:00'));
      const agora = Date.now();
      const dentro = visita202({
        id: 1000700, data_entrada: new Date(agora - HORA),
        data_hora_inicio: new Date(agora - 2 * HORA), data_hora_termino: new Date(agora + HORA),
        created_at: new Date(agora - 2 * HORA), updated_at: new Date(agora - HORA),
      });
      const recorrente = visita101({
        id: 1000701, dias_semana: 'dom,seg,ter,qua,qui,sex,sab',
        data_hora_inicio: new Date(agora - HORA), data_hora_termino: new Date(agora + 5 * 24 * HORA),
        created_at: new Date(agora - 10 * MIN), updated_at: new Date(agora - 10 * MIN),
      });
      const { svc, client } = montar([recorrente, dentro]);
      await svc.syncPessoa(ID_PESSOA);
      const fmt = (d: Date) => (svc as any).formatDahuaTime(d);
      expect(client.updatePerson).toHaveBeenCalledWith(
        expect.anything(), 'face_joao',
        expect.objectContaining({ validFrom: fmt(dentro.data_hora_inicio), validTo: fmt(dentro.data_hora_termino), userTimes: 1 }),
      );
    });
  });

  // I-3: a tolerância de 15 min só vale DEPOIS do término. Antes do início
  // exato a visita não é elegível para a entrada enquanto houver outra vigente.
  it('13h50: o 202 agendou para 14h (mais recente) e o 101 está liberado até 18h — a entrada cai no 101', async () => {
    jest.setSystemTime(new Date('2026-11-16T16:50:00Z')); // 13:50 BRT
    const agora = Date.now();
    const a202 = visita202({
      data_hora_inicio: new Date(agora + 10 * MIN), data_hora_termino: new Date(agora + 4 * HORA),
      created_at: new Date(agora - MIN), updated_at: new Date(agora - MIN),
    });
    const b101 = visita101({
      data_hora_inicio: new Date(agora - HORA), data_hora_termino: new Date(agora + 4 * HORA + 10 * MIN),
      created_at: new Date(agora - 2 * HORA), updated_at: new Date(agora - HORA),
    });
    const { svc, prisma } = montar([a202, b101]);
    await svc.processWebhook('tok-entrada', {
      event: 'entrada', direction: 'in', external_id: `pessoa_${ID_PESSOA}`, timestamp: new Date().toISOString(),
    });
    expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: b101.id }), data: expect.objectContaining({ data_entrada: expect.any(Date) }) }),
    );
    const negados = prisma.acessos_Facial.create.mock.calls.filter((c: any[]) => c[0]?.data?.evento === 'negado');
    expect(negados).toHaveLength(0);
    expect(prisma.users.findMany.mock.calls[0][0].where.apartamentosUsers.some.id_apto).toBe(101);
  });
});
