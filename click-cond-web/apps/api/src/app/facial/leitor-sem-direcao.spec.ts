/**
 * Leitor sem direção (tag, QR e LPR) x terminal facial.
 *
 * Leitor de tag/QR e câmera LPR ficam de UM lado do portão: em `auto` e sem
 * direção no payload a leitura de MORADOR/FUNCIONÁRIO é ENTRADA (não alterna
 * pelo último acesso), e o anti-passback por histórico não vale para eles —
 * num portão com antena só na entrada e saída livre, a segunda entrada era
 * negada para sempre. Só com ANTI_PASSBACK_MODE=hard o bloqueio volta. Pelo
 * mesmo motivo a marca "(Suspeita de anti-passback)" do modo soft não é
 * aplicada à entrada de morador/funcionário em leitor.
 *
 * VISITANTE/PRESTADOR em leitor `auto` sem direção segue o estado real da
 * visita: dentro (entrou e não saiu) → saída (baixa); fora → entrada.
 *
 * Terminal facial NÃO muda: em `auto` segue alternando e em `entrada` segue
 * negando a segunda entrada seguida.
 *
 * Mocks, sem banco e sem aparelho.
 */
let FacialService: any;
let AccessStateService: any;

describe('FacialService — leitor sem direção e anti-passback', () => {
  const modoOriginal = process.env.ANTI_PASSBACK_MODE;

  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
      AccessStateService = require('./access-state.service').AccessStateService;
    });
  });
  afterEach(() => {
    if (modoOriginal === undefined) delete process.env.ANTI_PASSBACK_MODE;
    else process.env.ANTI_PASSBACK_MODE = modoOriginal;
  });
  afterAll(() => {
    jest.useRealTimers();
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

  /**
   * `acessos` é o histórico: o que o webhook grava passa a ser o "último
   * acesso" da leitura seguinte, como no banco.
   */
  function build(
    device: any,
    opts: { accessStateReal?: boolean; visitante?: any; antiPassback?: string; etapa?: any } = {},
  ) {
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
        // Como no banco: a baixa/entrada muda o estado lido pela leitura seguinte.
        updateMany: jest.fn(async ({ data }: any) => {
          if (!vis) return { count: 0 };
          Object.assign(vis, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => Object.assign(vis ?? {}, data)),
      },
      veiculos: {
        findMany: jest.fn(async () => [{ id: 5, placa: 'ABC1D23', morador: ANA }]),
      },
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
      caminhos_Etapas: { findFirst: jest.fn(async () => opts.etapa ?? null) },
      users: { findMany: jest.fn(async () => []) },
    };
    const client: any = { triggerRelay: jest.fn(async () => ({ ok: true })) };
    const accessState: any = opts.accessStateReal
      ? new AccessStateService()
      : {
          shouldDebounce: jest.fn(() => false),
          checkAntiPassback: jest.fn(() => opts.antiPassback ?? 'allow'),
          hasPresenca: jest.fn(() => false),
          setPresenca: jest.fn(),
        };
    const svc = new FacialService(
      prisma,
      client,
      { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn(() => null) } as any,
      { registrar: jest.fn() } as any,
      accessState,
      {} as any,
    );
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    // Re-sync do visitante no aparelho (pós-entrada/saída): fora do assunto.
    jest.spyOn(svc as any, 'syncVisitante').mockResolvedValue(undefined);
    return { svc, prisma, client, acessos, accessState };
  }

  /** Eventos gravados pela leitura (sem as linhas `acionado_auto` da abertura). */
  const eventos = (acessos: any[]) =>
    acessos.map((a) => a.evento).filter((e) => e !== 'acionado_auto');

  const TS = ['2026-07-20T10:00:00.000Z', '2026-07-20T18:00:00.000Z', '2026-07-21T10:00:00.000Z'];
  const tag = (i: number, extra: any = {}) => ({ card_uid: 'ABC999', timestamp: TS[i], ...extra });
  const placa = (i: number) => ({ placa: 'ABC1D23', event: 'recognized', timestamp: TS[i] });
  const qr = (i: number) => ({ qrcode: 'QR-ANA', timestamp: TS[i] });
  const rosto = (i: number) => ({ external_id: 'morador_11', timestamp: TS[i] });

  /** Visitante com autorização vigente em todos os TS; FORA por padrão. */
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
  const tagVisitante = (i: number) => ({ card_uid: 'VIS777', timestamp: TS[i] });
  const qrVisitante = (i: number) => ({ qrcode: 'QR-VIS', timestamp: TS[i] });

  // ------------------------------------------------------------ leitores
  describe.each([
    ['tag_reader', tag],
    ['lpr', placa],
    ['qrcode_reader', qr],
  ])('%s', (tipo, leitura) => {
    it('em "auto" sem direção: é entrada e abre, duas vezes seguidas', async () => {
      const { svc, client, acessos } = build(dispositivo(tipo, 'auto'));

      const r1 = await svc.processWebhook('tok', leitura(0));
      const r2 = await svc.processWebhook('tok', leitura(1));

      expect(r1.evento).toBe('entrada');
      expect(r2.evento).toBe('entrada');
      expect(eventos(acessos)).toEqual(['entrada', 'entrada']);
      expect(client.triggerRelay).toHaveBeenCalledTimes(2);
    });

    it('em "entrada": duas entradas seguidas abrem (antena só na entrada, saída livre)', async () => {
      const { svc, client, acessos } = build(dispositivo(tipo, 'entrada'));

      await svc.processWebhook('tok', leitura(0));
      const r2 = await svc.processWebhook('tok', leitura(1));

      expect(r2.evento).toBe('entrada');
      expect(eventos(acessos)).toEqual(['entrada', 'entrada']);
      expect(client.triggerRelay).toHaveBeenCalledTimes(2);
    });

    it('com ANTI_PASSBACK_MODE=hard a segunda entrada seguida é negada', async () => {
      process.env.ANTI_PASSBACK_MODE = 'hard';
      const { svc, client, acessos } = build(dispositivo(tipo, 'auto'));

      await svc.processWebhook('tok', leitura(0));
      await expect(svc.processWebhook('tok', leitura(1))).rejects.toThrow(/anti-passback/i);

      expect(eventos(acessos)).toEqual(['entrada', 'negado']);
      expect(client.triggerRelay).toHaveBeenCalledTimes(1);
    });
  });

  it('tag_reader em "saida" continua registrando saída', async () => {
    const { svc } = build(dispositivo('tag_reader', 'saida'));

    const res = await svc.processWebhook('tok', tag(0));

    expect(res.evento).toBe('saida');
  });

  it('tag_reader em "auto" respeita a direção informada no payload', async () => {
    const { svc } = build(dispositivo('tag_reader', 'auto'));

    await svc.processWebhook('tok', tag(0));
    const res = await svc.processWebhook('tok', tag(1, { direction: 'out' }));

    expect(res.evento).toBe('saida');
  });

  // Com o AccessStateService de verdade (debounce + anti-passback em memória).
  it('tag_reader em "auto" com o estado em memória real (modo padrão): as duas entradas abrem', async () => {
    delete process.env.ANTI_PASSBACK_MODE;
    const { svc, client, acessos } = build(dispositivo('tag_reader', 'auto'), { accessStateReal: true });

    await svc.processWebhook('tok', tag(0));
    jest.advanceTimersByTime(20_000); // sai da janela de debounce (15 s)
    const r2 = await svc.processWebhook('tok', tag(1));

    expect(r2.evento).toBe('entrada');
    expect(eventos(acessos)).toEqual(['entrada', 'entrada']);
    expect(client.triggerRelay).toHaveBeenCalledTimes(2);
    // Antena só na entrada: a entrada repetida é o normal, não é suspeita.
    expect(acessos.map((a) => a.nome_pessoa).join('|')).not.toMatch(/Suspeita/);
  });

  // ------------------------------------------- marca "(Suspeita de anti-passback)"
  describe('marca "(Suspeita de anti-passback)" do modo soft', () => {
    const registrado = (acessos: any[]) => acessos.find((a) => a.evento !== 'acionado_auto');

    it.each([
      ['tag_reader', tag],
      ['lpr', placa],
      ['qrcode_reader', qr],
    ])('%s: entrada de morador NÃO é marcada, e o estado de presença segue sendo atualizado', async (tipo, leitura) => {
      const { svc, acessos, accessState } = build(dispositivo(tipo, 'auto'), {
        antiPassback: 'allow_with_warning',
      });

      const res = await svc.processWebhook('tok', leitura(0));

      expect(res.evento).toBe('entrada');
      expect(registrado(acessos).nome_pessoa).toBe('Ana');
      expect(accessState.checkAntiPassback).toHaveBeenCalledWith(1, 'morador', 11, 'entrada');
    });

    it('tag_reader: entrada de FUNCIONÁRIO também não é marcada', async () => {
      const { svc, prisma, acessos } = build(dispositivo('tag_reader', 'entrada'), {
        antiPassback: 'allow_with_warning',
      });
      const func = { ...ANA, tipo: 'funcionario' };
      prisma.moradores.findFirst.mockResolvedValue(func);
      prisma.moradores.findMany.mockResolvedValue([func]);

      await svc.processWebhook('tok', tag(0));

      expect(registrado(acessos)).toEqual(
        expect.objectContaining({ tipo_pessoa: 'funcionario', nome_pessoa: 'Ana', evento: 'entrada' }),
      );
    });

    it('tag_reader: SAÍDA de morador continua marcada', async () => {
      const { svc, acessos } = build(dispositivo('tag_reader', 'saida'), {
        antiPassback: 'allow_with_warning',
      });

      await svc.processWebhook('tok', tag(0));

      expect(registrado(acessos).nome_pessoa).toBe('Ana (Suspeita de anti-passback)');
    });

    it('tag_reader: o modo hard continua NEGANDO a entrada repetida (decisão "deny" do estado em memória)', async () => {
      const { svc, client, acessos } = build(dispositivo('tag_reader', 'auto'), {
        antiPassback: 'deny',
      });

      await expect(svc.processWebhook('tok', tag(0))).rejects.toThrow(/anti-passback/i);

      expect(eventos(acessos)).toEqual(['negado']);
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('tag_reader: "deny" rebaixado por backlog (modo hard) continua marcado', async () => {
      const { svc, acessos } = build(dispositivo('tag_reader', 'auto'), { antiPassback: 'deny' });

      await svc.processWebhook('tok', tag(0, { backlog: true }));

      expect(registrado(acessos).nome_pessoa).toBe('Ana (Suspeita de anti-passback)');
    });

    it('tag_reader: entrada de VISITANTE continua marcada', async () => {
      const { svc, acessos } = build(dispositivo('tag_reader', 'entrada'), {
        antiPassback: 'allow_with_warning',
        visitante: visitante(),
      });

      await svc.processWebhook('tok', tagVisitante(0));

      expect(registrado(acessos).nome_pessoa).toBe('Vítor (Suspeita de anti-passback)');
    });

    it('terminal facial não muda: entrada de morador continua marcada', async () => {
      const { svc, acessos } = build(dispositivo('facial', 'auto'), {
        antiPassback: 'allow_with_warning',
      });

      const res = await svc.processWebhook('tok', rosto(0));

      expect(res.evento).toBe('entrada');
      expect(registrado(acessos).nome_pessoa).toBe('Ana (Suspeita de anti-passback)');
    });
  });

  // ------------------------------------------- visitante/prestador em leitor "auto"
  describe('visitante/prestador em leitor "auto" sem direção: decide pelo estado da visita', () => {
    it.each([
      ['tag_reader', tagVisitante],
      ['qrcode_reader', qrVisitante],
    ])('%s: FORA → entrada; DENTRO → saída (baixa)', async (tipo, leitura) => {
      const vis = visitante({ is_prestador: 1 }); // prestador: segue liberado após a saída
      const { svc, acessos } = build(dispositivo(tipo, 'auto'), { visitante: vis });

      const r1 = await svc.processWebhook('tok', leitura(0));
      expect(r1.evento).toBe('entrada');
      expect(vis.data_entrada).toEqual(new Date(TS[0]));
      expect(vis.data_saida).toBeNull();

      const r2 = await svc.processWebhook('tok', leitura(1));
      expect(r2.evento).toBe('saida');
      expect(vis.data_saida).toEqual(new Date(TS[1]));

      expect(eventos(acessos)).toEqual(['entrada', 'saida']);

      // O QR é de uso único (a saída apaga o código); a tag segue valendo.
      if (tipo === 'tag_reader') {
        const r3 = await svc.processWebhook('tok', leitura(2));
        expect(r3.evento).toBe('entrada');
        expect(eventos(acessos)).toEqual(['entrada', 'saida', 'entrada']);
      }
    });

    it('tag_reader: visitante DENTRO (entrada dada por outro caminho, sem histórico) recebe saída', async () => {
      const vis = visitante({ data_entrada: new Date('2026-07-20T08:00:00.000Z') });
      const { svc, acessos } = build(dispositivo('tag_reader', 'auto'), { visitante: vis });

      const res = await svc.processWebhook('tok', tagVisitante(0));

      expect(res.evento).toBe('saida');
      expect(vis.data_saida).toEqual(new Date(TS[0]));
      expect(eventos(acessos)).toEqual(['saida']);
    });

    // Revisão 11/11: saída INFERIDA pelo estado da visita não pode abrir portão.
    // Prestador entrou, saiu por saída livre (ficou "dentro" para sempre) e volta
    // dias depois, com a validade vencida, no leitor de ENTRADA em `auto`.
    it('tag_reader "auto" em etapa de caminho: prestador DENTRO e com validade VENCIDA recebe a baixa e NÃO abre nada', async () => {
      const vis = visitante({
        is_prestador: 1,
        data_entrada: new Date('2026-07-01T08:00:00.000Z'),
        data_hora_inicio: new Date('2026-07-01T00:00:00.000Z'),
        data_hora_termino: new Date('2026-07-02T00:00:00.000Z'),
      });
      const etapa = { id: 1, ordem: 1, id_leitor: 42, abertura: PORTAO, caminho: { nome: 'Entrada' } };
      const { svc, client, acessos } = build(dispositivo('tag_reader', 'auto'), { visitante: vis, etapa });

      const res = await svc.processWebhook('tok', tagVisitante(0));

      expect(res.evento).toBe('saida');
      expect(vis.data_saida).toEqual(new Date(TS[0]));
      expect(acessos.map((a) => a.evento)).toEqual(['saida']);
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('tag_reader "auto" em etapa de caminho: saída com direção informada no payload continua abrindo', async () => {
      const vis = visitante({ is_prestador: 1, data_entrada: new Date('2026-07-20T08:00:00.000Z') });
      const etapa = { id: 1, ordem: 1, id_leitor: 42, abertura: PORTAO, caminho: { nome: 'Saída' } };
      const { svc, client } = build(dispositivo('tag_reader', 'auto'), { visitante: vis, etapa });

      const res = await svc.processWebhook('tok', { ...tagVisitante(0), direction: 'out' });

      expect(res.evento).toBe('saida');
      expect(client.triggerRelay).toHaveBeenCalledTimes(1);
    });

    it('tag_reader em "saida" (explícito) em etapa de caminho: a baixa do visitante abre', async () => {
      const vis = visitante({ is_prestador: 1, data_entrada: new Date('2026-07-20T08:00:00.000Z') });
      const etapa = { id: 1, ordem: 1, id_leitor: 42, abertura: PORTAO, caminho: { nome: 'Saída' } };
      const { svc, client } = build(dispositivo('tag_reader', 'saida'), { visitante: vis, etapa });

      const res = await svc.processWebhook('tok', tagVisitante(0));

      expect(res.evento).toBe('saida');
      expect(client.triggerRelay).toHaveBeenCalledTimes(1);
    });

    it('tag_reader: visitante FORA (baixa manual, sem evento de saída no histórico) recebe entrada — o histórico não decide', async () => {
      const vis = visitante();
      const { svc, acessos } = build(dispositivo('tag_reader', 'auto'), { visitante: vis });
      // Histórico diz "entrada" (a saída foi dada pela portaria, sem evento).
      acessos.push({ evento: 'entrada', id_pessoa: vis.id, tipo_pessoa: 'visitante' });

      const res = await svc.processWebhook('tok', tagVisitante(0));

      expect(res.evento).toBe('entrada');
    });

    it('tag_reader: MORADOR continua sempre entrada (não alterna)', async () => {
      const { svc, acessos } = build(dispositivo('tag_reader', 'auto'), { visitante: visitante() });

      await svc.processWebhook('tok', tag(0));
      const r2 = await svc.processWebhook('tok', tag(1));

      expect(r2.evento).toBe('entrada');
      expect(eventos(acessos)).toEqual(['entrada', 'entrada']);
    });
  });

  // ------------------------------------------------------------ facial (regressão)
  describe('terminal facial não muda', () => {
    it('em "auto" sem direção continua alternando entrada → saída → entrada', async () => {
      const { svc, acessos } = build(dispositivo('facial', 'auto'));

      const r1 = await svc.processWebhook('tok', rosto(0));
      const r2 = await svc.processWebhook('tok', rosto(1));
      const r3 = await svc.processWebhook('tok', rosto(2));

      expect([r1.evento, r2.evento, r3.evento]).toEqual(['entrada', 'saida', 'entrada']);
      expect(eventos(acessos)).toEqual(['entrada', 'saida', 'entrada']);
    });

    it('em "entrada" a segunda entrada seguida continua negada (anti-passback por histórico)', async () => {
      delete process.env.ANTI_PASSBACK_MODE;
      const { svc, acessos } = build(dispositivo('facial', 'entrada'));

      await svc.processWebhook('tok', rosto(0));
      await expect(svc.processWebhook('tok', rosto(1))).rejects.toThrow(/anti-passback/i);

      expect(eventos(acessos)).toEqual(['entrada', 'negado']);
      expect(acessos[1].nome_pessoa).toMatch(/Anti-passback/);
    });

    it('em "entrada" com ANTI_PASSBACK_MODE=off a segunda entrada seguida continua negada', async () => {
      process.env.ANTI_PASSBACK_MODE = 'off';
      const { svc } = build(dispositivo('facial', 'entrada'));

      await svc.processWebhook('tok', rosto(0));
      await expect(svc.processWebhook('tok', rosto(1))).rejects.toThrow(/anti-passback/i);
    });
  });
});
