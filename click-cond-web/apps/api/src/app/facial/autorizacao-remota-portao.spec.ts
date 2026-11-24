/**
 * Rodada 4, item 1: a autorização REMOTA (o morador respondeu, pelo app, ao
 * pedido da portaria) vale 10 min também no portão. O console já dizia
 * "expirada" aos 10 min, mas o leitor de QR/PIN e o rosto aceitavam por toda a
 * janela que o pedido abre (agora → +4 h, mais 15 min de tolerância).
 *
 * Não mudam: pré-autorização do morador com janela própria, recorrente,
 * prestador, vaga cedida e a liberação feita pela portaria. Quem entrou dentro
 * do prazo continua saindo.
 */
let FacialService: any;

const MIN = 60 * 1000;

describe('FacialService — autorização remota vale 10 min no portão', () => {
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

  const DEVICE_QR = {
    id: 2, id_condominio: 1, tipo: 'qrcode_reader', sentido: 'entrada', ativo: 1,
    confianca_minima: 0, nome: 'Leitor QR', webhook_token: 'tok-qr',
  };
  const DEVICE_SAIDA = {
    id: 3, id_condominio: 1, tipo: 'facial', sentido: 'saida', ativo: 1,
    confianca_minima: 0, nome: 'Facial saída', webhook_token: 'tok-saida',
  };
  const DEVICE_FACIAL = {
    id: 900, id_condominio: 1, ip: '10.0.0.5', porta: 80, api_user: 'admin', api_password: 'admin',
    fabricante: 'intelbras', ativo: 1, tipo: 'facial', sentido: 'entrada',
  };

  /** Pedido da portaria respondido pelo morador (Users.id 77) há `respondidaHaMin` minutos. */
  function visitaRemota(respondidaHaMin: number, extra: Record<string, unknown> = {}) {
    const agora = Date.now();
    const respondida = new Date(agora - respondidaHaMin * MIN);
    return {
      id: 1000100, id_pessoa: 2000100, id_condominio: 1, id_apartamento: 101,
      is_visitante: 1, is_prestador: 0, liberado: 1, bloqueado: 0,
      codigo_acesso: '654321', tag_rfid: null, dias_semana: null,
      data_hora_inicio: new Date(respondida.getTime() - MIN),
      data_hora_termino: new Date(respondida.getTime() - MIN + 4 * 60 * MIN),
      data_entrada: null, data_saida: null,
      auth_status: 'autorizado',
      auth_solicitado_em: new Date(respondida.getTime() - MIN),
      auth_respondido_em: respondida,
      auth_respondido_por: 77,
      created_at: new Date(respondida.getTime() - MIN),
      pessoa: { id: 2000100, nome: 'QA Remota', bloqueado: 0 },
      ...extra,
    };
  }

  function montar(visita: any, opts: { vagaVigente?: boolean; device?: any } = {}) {
    const pessoa = {
      id: visita.id_pessoa, id_condominio: 1, nome: 'QA Remota', tipo_pessoa: 'visitante',
      foto_pessoa: 'http://foto.jpg', face_id: 'face_remota', face_sync_status: 'synced', bloqueado: 0,
      visitas: [visita],
    };
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => opts.device ?? DEVICE_QR),
        findMany: jest.fn(async () => [DEVICE_FACIAL]),
      },
      moradores: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      tags: { findMany: jest.fn(async () => []) },
      visitantes: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null) },
      visitas: {
        findMany: jest.fn(async () => [visita]),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async () => visita),
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
      vagas: {
        count: jest.fn(async () => (opts.vagaVigente ? 1 : 0)),
        findMany: jest.fn(async () => (opts.vagaVigente ? [{ id_visita: visita.id }] : [])),
      },
      users: { findMany: jest.fn(async () => []) },
    };
    const client = {
      enrollPerson: jest.fn(async () => ({ faceId: 'face_remota' })),
      updatePerson: jest.fn(async () => undefined),
      removePerson: jest.fn(async () => undefined),
    };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const svc = new FacialService(
      prisma, client as any, { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn(() => null) } as any, { registrar: jest.fn() } as any,
      accessState, {} as any, { assertCondominio: jest.fn() } as any,
      { autorizouBiometria: jest.fn(async () => true) } as any,
      { autorizouBiometria: jest.fn(async () => true) } as any,
    );
    jest.spyOn(svc as any, 'fetchPhotoAsBase64').mockResolvedValue('BASE64');
    return { svc, prisma, client, pessoa };
  }

  const lerQr = (svc: any) =>
    svc.processWebhook('tok-qr', { event: 'entrada', external_id: '654321', timestamp: new Date().toISOString() });

  const negados = (prisma: any) =>
    prisma.acessos_Facial.create.mock.calls.filter((c: any[]) => c[0]?.data?.evento === 'negado');

  describe('QR/PIN no terminal', () => {
    it('aos 9 min da resposta do morador: abre', async () => {
      const visita = visitaRemota(9);
      const { svc, prisma } = montar(visita);
      await lerQr(svc);
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: visita.id }) }),
      );
      expect(negados(prisma)).toHaveLength(0);
    });

    it('aos 12 min: recusa com o motivo, sem registrar a entrada', async () => {
      const { svc, prisma } = montar(visitaRemota(12));
      await expect(lerQr(svc)).rejects.toThrow(/autorização do morador expirou/);
      expect(prisma.visitas.updateMany).not.toHaveBeenCalled();
      expect(negados(prisma)).toHaveLength(1);
    });

    it('pré-autorização do morador (janela de 4 h, sem pedido): abre aos 30 min', async () => {
      const visita = visitaRemota(30, {
        auth_status: null, auth_solicitado_em: null, auth_respondido_em: null, auth_respondido_por: null, user: 77,
      });
      const { svc, prisma } = montar(visita);
      await lerQr(svc);
      expect(prisma.visitas.updateMany).toHaveBeenCalled();
    });

    it('pedido resolvido pela portaria (porteiro, sem Users.id): abre aos 30 min', async () => {
      const { svc, prisma } = montar(visitaRemota(30, { auth_respondido_por: null }));
      await lerQr(svc);
      expect(prisma.visitas.updateMany).toHaveBeenCalled();
    });

    it('o morador cedeu vaga depois de autorizar: a vaga tem janela própria, abre aos 30 min', async () => {
      const { svc, prisma } = montar(visitaRemota(30), { vagaVigente: true });
      await lerQr(svc);
      expect(prisma.visitas.updateMany).toHaveBeenCalled();
    });

    it('a pessoa entrou dentro do prazo: sai normalmente aos 40 min', async () => {
      const visita = visitaRemota(40, { data_entrada: new Date(Date.now() - 35 * MIN) });
      const { svc, prisma } = montar(visita, { device: DEVICE_SAIDA });
      await svc.processWebhook('tok-saida', {
        event: 'saida', direction: 'out', external_id: 'pessoa_2000100', timestamp: new Date().toISOString(),
      });
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: visita.id }),
          data: expect.objectContaining({ data_saida: expect.any(Date) }),
        }),
      );
    });
  });

  describe('rosto (janela enviada ao aparelho)', () => {
    it('aos 9 min: o aparelho recebe ValidTo = resposta + 10 min, não o fim das 4 h', async () => {
      const visita = visitaRemota(9);
      const { svc, client } = montar(visita);
      await svc.syncPessoa(visita.id_pessoa);
      const esperado = (svc as any).formatDahuaTime(new Date(visita.auth_respondido_em.getTime() + 10 * MIN));
      expect(client.updatePerson).toHaveBeenCalledWith(
        expect.anything(), 'face_remota', expect.objectContaining({ validTo: esperado }),
      );
    });

    it('aos 12 min: o rosto sai do terminal no sync', async () => {
      const visita = visitaRemota(12);
      const { svc } = montar(visita);
      const unsync = jest.spyOn(svc as any, 'unsyncPessoa').mockResolvedValue(true);
      const r = await svc.syncPessoa(visita.id_pessoa);
      expect(unsync).toHaveBeenCalled();
      expect(r).toMatchObject({ syncState: 'revoked' });
    });

    it('pré-autorização do morador de 4 h: ValidTo é o fim da janela', async () => {
      const visita = visitaRemota(30, {
        auth_status: null, auth_solicitado_em: null, auth_respondido_em: null, auth_respondido_por: null,
      });
      const { svc, client } = montar(visita);
      await svc.syncPessoa(visita.id_pessoa);
      const esperado = (svc as any).formatDahuaTime(visita.data_hora_termino);
      expect(client.updatePerson).toHaveBeenCalledWith(
        expect.anything(), 'face_remota', expect.objectContaining({ validTo: esperado }),
      );
    });

    it('entrou dentro do prazo: aos 40 min segue no leitor de saída', async () => {
      const visita = visitaRemota(40, { data_entrada: new Date(Date.now() - 35 * MIN) });
      const { svc, prisma, client } = montar(visita);
      prisma.facial_Devices.findMany.mockResolvedValue([{ ...DEVICE_FACIAL, sentido: 'saida' }]);
      const unsync = jest.spyOn(svc as any, 'unsyncPessoa').mockResolvedValue(true);
      await svc.syncPessoa(visita.id_pessoa);
      expect(unsync).not.toHaveBeenCalled();
      expect(client.updatePerson).toHaveBeenCalled();
      expect(client.removePerson).not.toHaveBeenCalled();
    });
  });

  it('o tick de expiração pega a autorização remota que venceu (o rosto sai no ciclo normal)', async () => {
    const { svc, prisma } = montar(visitaRemota(12));
    prisma.visitantes.findMany = jest.fn(async () => []);
    prisma.pessoas.findMany = jest.fn(async () => []);
    await (svc as any).tickExpiracaoAutomatica();
    const where = JSON.stringify(prisma.pessoas.findMany.mock.calls[0][0].where);
    expect(where).toContain('auth_respondido_por');
    expect(where).toContain('"auth_status":"autorizado"');
  });

  // Rodada 1, I-2: a autorização remota vale para UMA entrada. Usada, serve só
  // para sair; nova entrada é novo pedido ou a portaria liberar.
  describe('uma entrada só', () => {
    it('avulso entrou aos 5 min, saiu sem leitor; às 2 h tenta entrar de novo pelo QR: negado', async () => {
      const visita = visitaRemota(120, { data_entrada: new Date(Date.now() - 115 * MIN) });
      const { svc, prisma } = montar(visita);
      await expect(lerQr(svc)).rejects.toThrow(/já foi usada/);
      expect(prisma.visitas.updateMany).not.toHaveBeenCalled();
      expect(negados(prisma)).toHaveLength(1);
    });

    it('… e o rosto não volta ao terminal de entrada (só o de saída o mantém)', async () => {
      const visita = visitaRemota(120, { data_entrada: new Date(Date.now() - 115 * MIN) });
      const { svc, prisma, client } = montar(visita);
      prisma.facial_Devices.findMany.mockResolvedValue([
        DEVICE_FACIAL,
        { ...DEVICE_FACIAL, id: 901, sentido: 'saida' },
      ]);
      await svc.syncPessoa(visita.id_pessoa);
      expect(client.removePerson).toHaveBeenCalledWith(expect.objectContaining({}), 'face_remota', 'pessoa_2000100');
      expect(client.removePerson).toHaveBeenCalledTimes(1); // o de entrada
      expect(client.updatePerson).toHaveBeenCalledTimes(1); // o de saída
      expect(client.updatePerson.mock.calls[0][2]).toEqual(expect.objectContaining({ validTo: undefined, userTimes: 1 }));
    });

    it('prestador vindo de pedido: entrou e saiu, às 2 h o QR nega mesmo com a janela de 4 h valendo', async () => {
      const visita = visitaRemota(120, {
        is_prestador: 1, is_visitante: 0,
        data_entrada: new Date(Date.now() - 115 * MIN), data_saida: new Date(Date.now() - 60 * MIN),
      });
      const { svc } = montar(visita);
      await expect(lerQr(svc)).rejects.toThrow(/já foi usada/);
    });

    it('prestador vindo de pedido: a saída pelo terminal não mantém a liberação', async () => {
      const visita = visitaRemota(30, {
        is_prestador: 1, is_visitante: 0, data_entrada: new Date(Date.now() - 25 * MIN),
      });
      const { svc, prisma } = montar(visita, { device: DEVICE_SAIDA });
      await svc.processWebhook('tok-saida', {
        event: 'saida', direction: 'out', external_id: 'pessoa_2000100', timestamp: new Date().toISOString(),
      });
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ data_saida: expect.any(Date), liberado: 0 }) }),
      );
    });

    it('com vaga vigente cedida pelo morador a saída mantém a liberação e a reentrada abre', async () => {
      const visita = visitaRemota(120, {
        data_entrada: new Date(Date.now() - 115 * MIN), data_saida: new Date(Date.now() - 60 * MIN),
      });
      const { svc, prisma } = montar(visita, { vagaVigente: true });
      await lerQr(svc);
      expect(prisma.visitas.updateMany).toHaveBeenCalled();
    });
  });

  // Rodada 1, M-5: evento ao vivo é julgado pela hora do SERVIDOR; só o
  // backlog marcado como tal usa a hora do aparelho.
  describe('hora da decisão', () => {
    it('ao vivo com o relógio do aparelho atrasado (diz 9 min, servidor 12 min): negado', async () => {
      const visita = visitaRemota(12);
      const { svc } = montar(visita);
      const relogioAtrasado = new Date(visita.auth_respondido_em.getTime() + 9 * MIN).toISOString();
      await expect(
        svc.processWebhook('tok-qr', { event: 'entrada', external_id: '654321', timestamp: relogioAtrasado }),
      ).rejects.toThrow(/autorização do morador expirou/);
    });

    it('backlog do rosto que passou aos 9 min e chegou aos 12: aceito (o aparelho tinha o prazo)', async () => {
      const visita = visitaRemota(12);
      const { svc, prisma } = montar(visita, { device: { ...DEVICE_SAIDA, id: 6, sentido: 'entrada', webhook_token: 'tok-ent' } });
      const aos9 = new Date(visita.auth_respondido_em.getTime() + 9 * MIN).toISOString();
      await svc.processWebhook('tok-ent', {
        event: 'entrada', direction: 'in', external_id: 'pessoa_2000100', timestamp: aos9, backlog: true,
      });
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: visita.id }) }),
      );
    });
  });

  // Rodada 2, Importante 1: o sentido `auto` é o padrão (um facial só na
  // portaria). Quem entrou pela autorização remota tem de conseguir SAIR por
  // ele: o rosto fica no `auto` com 1 uso; a próxima leitura vira saída e a
  // saída tira o rosto de todos. No leitor só de entrada o rosto sai.
  describe('terminal de sentido auto', () => {
    const DEVICE_AUTO_WEBHOOK = {
      id: 7, id_condominio: 1, tipo: 'facial', sentido: 'auto', ativo: 1,
      confianca_minima: 0, nome: 'Facial portaria', webhook_token: 'tok-auto',
    };
    const lerRosto = (svc: any) =>
      svc.processWebhook('tok-auto', { event: 'reconhecimento', external_id: 'pessoa_2000100', timestamp: new Date().toISOString() });

    for (const tipo of ['avulso', 'prestador'] as const) {
      const extra = tipo === 'prestador' ? { is_prestador: 1, is_visitante: 0 } : {};

      it(`${tipo}: entra pelo auto → o rosto continua no auto com 1 uso (e sai do leitor só de entrada)`, async () => {
        const visita = visitaRemota(5, { ...extra });
        const { svc, prisma } = montar(visita, { device: DEVICE_AUTO_WEBHOOK });
        await lerRosto(svc);
        expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ data_entrada: expect.any(Date) }) }),
        );

        // Estado depois da entrada: dentro, autorização usada.
        const dentro = visitaRemota(6, { ...extra, data_entrada: new Date(Date.now() - MIN) });
        const m = montar(dentro);
        m.prisma.facial_Devices.findMany.mockResolvedValue([
          { ...DEVICE_FACIAL, id: 910, sentido: 'auto' },
          { ...DEVICE_FACIAL, id: 911, sentido: 'entrada' },
        ]);
        await m.svc.syncPessoa(dentro.id_pessoa);
        const noAuto = m.client.updatePerson.mock.calls.find((c: any[]) => c[0].id === 910);
        expect(noAuto?.[2]).toEqual(
          expect.objectContaining({
            userTimes: 1,
            validTo: (m.svc as any).formatDahuaTime(new Date(dentro.data_entrada.getTime() + 24 * 60 * MIN)),
          }),
        );
        expect(m.client.removePerson).toHaveBeenCalledWith(expect.objectContaining({ id: 911 }), 'face_remota', 'pessoa_2000100');
      });

      it(`${tipo}: a leitura seguinte no auto vira SAÍDA (não uma 2ª entrada), liberado vai a 0 e o rosto sai de todos`, async () => {
        const dentro = visitaRemota(30, { ...extra, data_entrada: new Date(Date.now() - 25 * MIN) });
        const { svc, prisma } = montar(dentro, { device: DEVICE_AUTO_WEBHOOK });
        // Último acesso registrado: a entrada (alternância do `auto`).
        prisma.acessos_Facial.findFirst.mockResolvedValue({ evento: 'entrada' });
        await lerRosto(svc);
        expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: dentro.id }),
            data: expect.objectContaining({ data_saida: expect.any(Date), liberado: 0 }),
          }),
        );
        expect(negados(prisma)).toHaveLength(0);

        // Depois da saída: sem liberação, o sync tira o rosto de todos.
        const saiu = visitaRemota(30, {
          ...extra, data_entrada: new Date(Date.now() - 25 * MIN), data_saida: new Date(), liberado: 0,
        });
        const m = montar(saiu);
        const unsync = jest.spyOn(m.svc as any, 'unsyncPessoa').mockResolvedValue(true);
        await m.svc.syncPessoa(saiu.id_pessoa);
        expect(unsync).toHaveBeenCalled();
      });
    }

    it('menor 2: prestador vindo de autorização remota, ainda não usado, vai ao aparelho com 1 uso', async () => {
      const visita = visitaRemota(3, { is_prestador: 1, is_visitante: 0 });
      const { svc, client } = montar(visita);
      await svc.syncPessoa(visita.id_pessoa);
      expect(client.updatePerson.mock.calls[0][2]).toEqual(expect.objectContaining({ userTimes: 1 }));
    });
  });

  // Revisão final, I1: dentro e "só para sair" num leitor que não é só de
  // saída (o `auto`) → SEMPRE 1 uso, qualquer categoria. Com -1, o prestador
  // que saiu sem passar pelo leitor reentrava à vontade, offline, por 24 h.
  describe('dentro, só para sair, no auto: sempre 1 uso', () => {
    const DEVICE_AUTO = {
      id: 8, id_condominio: 1, tipo: 'facial', sentido: 'auto', ativo: 1,
      confianca_minima: 0, nome: 'Facial portaria', webhook_token: 'tok-auto2',
    };
    /** Prestador comum (sem pedido), janela 8–10 h já encerrada, entrou às 9 h e não saiu. */
    function prestadorDentroForaDaJanela(extra: Record<string, unknown> = {}) {
      const agora = Date.now();
      return visitaRemota(0, {
        is_prestador: 1, is_visitante: 0,
        auth_status: null, auth_solicitado_em: null, auth_respondido_em: null, auth_respondido_por: null,
        data_hora_inicio: new Date(agora - 4 * 60 * MIN), data_hora_termino: new Date(agora - 2 * 60 * MIN),
        data_entrada: new Date(agora - 3 * 60 * MIN),
        ...extra,
      });
    }
    function devicesAutoESaida(m: any) {
      m.prisma.facial_Devices.findMany.mockResolvedValue([
        { ...DEVICE_FACIAL, id: 920, sentido: 'auto' },
        { ...DEVICE_FACIAL, id: 921, sentido: 'saida' },
      ]);
    }
    const doAparelho = (m: any, id: number) => m.client.updatePerson.mock.calls.find((c: any[]) => c[0].id === id)?.[2];

    it('prestador dentro fora da janela → auto com 1 uso e ValidTo = entrada + 24 h', async () => {
      const visita = prestadorDentroForaDaJanela();
      const m = montar(visita);
      devicesAutoESaida(m);
      await m.svc.syncPessoa(visita.id_pessoa);
      expect(doAparelho(m, 920)).toEqual(
        expect.objectContaining({
          userTimes: 1,
          validTo: (m.svc as any).formatDahuaTime(new Date(visita.data_entrada.getTime() + 24 * 60 * MIN)),
        }),
      );
      // Leitor só de saída: como em produção (sem ValidTo).
      expect(doAparelho(m, 921)).toEqual(expect.objectContaining({ validTo: undefined }));
    });

    it('a leitura seguinte no auto vira saída e, depois dela, o rosto sai de todos', async () => {
      const visita = prestadorDentroForaDaJanela();
      const { svc, prisma } = montar(visita, { device: DEVICE_AUTO });
      prisma.acessos_Facial.findFirst.mockResolvedValue({ evento: 'entrada' });
      await svc.processWebhook('tok-auto2', {
        event: 'reconhecimento', external_id: 'pessoa_2000100', timestamp: new Date().toISOString(),
      });
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ data_saida: expect.any(Date) }) }),
      );

      const saiu = prestadorDentroForaDaJanela({ data_saida: new Date() });
      const m = montar(saiu);
      const unsync = jest.spyOn(m.svc as any, 'unsyncPessoa').mockResolvedValue(true);
      await m.svc.syncPessoa(saiu.id_pessoa);
      expect(unsync).toHaveBeenCalled();
    });

    it('prestador dentro COM vaga vigente e a janela encerrada: também 1 uso no auto (a vaga não vira ilimitado fora da vigência da visita)', async () => {
      const visita = prestadorDentroForaDaJanela();
      const m = montar(visita, { vagaVigente: true });
      devicesAutoESaida(m);
      await m.svc.syncPessoa(visita.id_pessoa);
      expect(doAparelho(m, 920)).toEqual(expect.objectContaining({ userTimes: 1 }));
    });

    it('vaga vigente com a janela valendo (pode reentrar): segue ilimitado, como em produção', async () => {
      const agora = Date.now();
      const visita = prestadorDentroForaDaJanela({
        is_prestador: 0, is_visitante: 1,
        data_hora_termino: new Date(agora + 2 * 60 * MIN),
      });
      const m = montar(visita, { vagaVigente: true });
      devicesAutoESaida(m);
      await m.svc.syncPessoa(visita.id_pessoa);
      expect(doAparelho(m, 920)).toEqual(expect.objectContaining({ userTimes: -1 }));
    });
  });
});
