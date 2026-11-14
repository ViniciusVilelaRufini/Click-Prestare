/**
 * Webhook do leitor com código dinâmico (QR do app / passe do visitante).
 *
 * - código P1 vai para CredenciaisValidacaoService; o resultado entra no
 *   fluxo existente (morador direto; visita pelo PIN devolvido);
 * - negado grava "negado" com o texto do motivo e face_id `cred:<id>`;
 * - com "QR no app" ligado, o PIN lido como QR deixa de abrir;
 * - 10 negações em 60 s bloqueiam as leituras dinâmicas do leitor;
 * - o código lido nunca vai para log nem para Acessos_Facial.
 *
 * Mocks, sem banco e sem aparelho.
 */
import { gerarCodigo } from '../credenciais/codigo-dinamico.util';

let FacialService: any;
let AccessStateService: any;

const SEGREDO = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const AGORA = new Date('2026-07-20T10:00:05.000Z');
const CODIGO = gerarCodigo('P1', 7, Math.floor(AGORA.getTime() / 30_000), SEGREDO);
const BLOQUEIO = 'Leitor bloqueado por excesso de QR inválido (1 min)';

describe('FacialService — webhook com código dinâmico', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
      AccessStateService = require('./access-state.service').AccessStateService;
    });
  });
  beforeEach(() => {
    jest.setSystemTime(AGORA);
  });
  afterAll(() => {
    jest.useRealTimers();
    delete process.env.PESSOAS_MIGRATION_ENABLED;
  });

  const ANA = { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 1, tag_rfid: null, qrcode_acesso: 'QR-ANA' };
  const PORTAO = { id: 20, id_condominio: 1, tipo: 'botoeira', ativo: 1, nome: 'Portão' };
  const LEITOR = {
    id: 42,
    id_condominio: 1,
    tipo: 'qrcode_reader',
    sentido: 'entrada',
    ativo: 1,
    confianca_minima: 0,
    id_area_social: null,
    nome: 'Leitor QR',
    webhook_token: 'tok',
  };

  const visitante = (extra: any = {}) => ({
    id: 30,
    nome: 'Vítor Souza',
    id_condominio: 1,
    id_apartamento: 101,
    is_prestador: 0,
    liberado: 1,
    bloqueado: 0,
    tag_rfid: null,
    codigo_acesso: '482913',
    data_hora_inicio: new Date('2026-07-19T00:00:00.000Z'),
    data_hora_termino: new Date('2026-07-25T00:00:00.000Z'),
    data_entrada: null as Date | null,
    data_saida: null as Date | null,
    dias_semana: null,
    ...extra,
  });

  const okMorador = {
    ok: true,
    rotulo: 'cred:7',
    idCredencial: 7,
    contador: 1,
    alvo: { tipo: 'morador', morador: { id: 11, nome: 'Ana', tipo: 'morador' } },
  };
  const okVisita = (pin = '482913', idVisita = 30) => ({
    ok: true,
    rotulo: 'cred:7',
    idCredencial: 7,
    contador: 1,
    alvo: { tipo: 'visita', idVisita, codigoAcesso: pin },
  });
  const negado = (motivo = 'assinatura') => ({ ok: false, rotulo: 'cred:7', motivo });

  function build(
    opts: {
      validacao?: any;
      opcao?: boolean;
      visitante?: any;
      /** Várias linhas de visita (ex.: duas com o mesmo PIN). */
      visitantes?: any[];
      sessaoDeCaptura?: any;
      accessStateReal?: boolean;
    } = {},
  ) {
    const acessos: any[] = [];
    const vis = opts.visitante ?? null;
    const linhas: any[] = opts.visitantes ?? (vis ? [vis] : []);
    const visitantesPor = ({ where }: any) =>
      linhas.filter(
        (l) =>
          (where?.id === undefined || where.id === l.id) &&
          (where?.codigo_acesso === undefined || where.codigo_acesso === l.codigo_acesso),
      );
    const filtraMoradores = ({ where }: any) =>
      [ANA].filter(
        (m) =>
          (where.id === undefined || where.id === m.id) &&
          (where.qrcode_acesso === undefined || where.qrcode_acesso === m.qrcode_acesso) &&
          (where.tag_rfid === undefined || false) &&
          (where.face_id === undefined || false),
      );
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => LEITOR),
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
        updateMany: jest.fn(async ({ where, data }: any) => {
          const alvos = visitantesPor({ where: { id: where?.id } });
          for (const l of alvos) Object.assign(l, data);
          return { count: alvos.length };
        }),
        update: jest.fn(async ({ where, data }: any) =>
          Object.assign(visitantesPor({ where: { id: where?.id } })[0] ?? {}, data),
        ),
      },
      veiculos: { findMany: jest.fn(async () => []) },
      vagas: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
      acessos_Facial: {
        create: jest.fn(async ({ data }: any) => {
          acessos.push(data);
          return { id: acessos.length };
        }),
        findFirst: jest.fn(async () => null),
      },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      users: { findMany: jest.fn(async () => []) },
    };
    const client: any = { triggerRelay: jest.fn(async () => ({ ok: true })) };
    const accessState: any = opts.accessStateReal
      ? new AccessStateService()
      : {
          shouldDebounce: jest.fn(() => false),
          checkAntiPassback: jest.fn(() => 'allow'),
          hasPresenca: jest.fn(() => false),
          setPresenca: jest.fn(),
        };
    const enrollSessions: any = { consumeForDevice: jest.fn(() => opts.sessaoDeCaptura ?? null) };
    const validacao: any = {
      validarLeitura: jest.fn(async () => opts.validacao ?? okMorador),
      qrAppHabilitado: jest.fn(async () => opts.opcao ?? true),
    };
    const svc = new FacialService(
      prisma,
      client,
      { sendPushNotification: jest.fn() } as any,
      enrollSessions,
      { registrar: jest.fn() } as any,
      accessState,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      validacao,
    );
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    jest.spyOn(svc as any, 'syncVisitante').mockResolvedValue(undefined);
    const logger = { warn: jest.fn(), debug: jest.fn(), log: jest.fn(), error: jest.fn(), verbose: jest.fn() };
    (svc as any).logger = logger;
    if (opts.accessStateReal) (accessState as any).logger = logger;
    return { svc, prisma, client, acessos, validacao, enrollSessions, logger };
  }

  const leitura = (extra: any = {}) => ({ qrcode: CODIGO, ...extra });
  const semAcionamento = (acessos: any[]) => acessos.filter((a) => a.evento !== 'acionado_auto');

  it('código P1 válido de morador registra entrada com face_id "cred:<id>" e aciona a ponte do leitor', async () => {
    const { svc, client, acessos, validacao } = build();

    const res = await svc.processWebhook('tok', leitura());

    expect(validacao.validarLeitura).toHaveBeenCalledWith(CODIGO, expect.objectContaining({ id: 42, id_condominio: 1 }), AGORA);
    expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'morador', id: 11, evento: 'entrada' }));
    expect(semAcionamento(acessos)).toEqual([
      expect.objectContaining({ face_id: 'cred:7', tipo_pessoa: 'morador', id_pessoa: 11, nome_pessoa: 'Ana', evento: 'entrada' }),
    ]);
    expect(client.triggerRelay).toHaveBeenCalledTimes(1);
    expect(acessos.find((a) => a.evento === 'acionado_auto')).toEqual(expect.objectContaining({ face_id: 'cred:7' }));
  });

  it('morador do tipo funcionário entra como funcionario', async () => {
    const { svc, acessos } = build({
      validacao: { ...okMorador, alvo: { tipo: 'morador', morador: { id: 11, nome: 'Ana', tipo: 'Funcionario' } } },
    });

    await svc.processWebhook('tok', leitura());

    expect(semAcionamento(acessos)[0]).toEqual(expect.objectContaining({ tipo_pessoa: 'funcionario' }));
  });

  it('código P1 válido de visita resolve pela visita do PIN devolvido e respeita a janela existente', async () => {
    const vis = visitante();
    const dentro = build({ validacao: okVisita('482913'), visitante: vis });

    const res = await dentro.svc.processWebhook('tok', leitura());

    expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'visitante', id: 30, evento: 'entrada' }));
    expect(semAcionamento(dentro.acessos)[0]).toEqual(
      expect.objectContaining({ face_id: 'cred:7', tipo_pessoa: 'visitante', id_pessoa: 30, evento: 'entrada' }),
    );
    const consultas = dentro.prisma.visitantes.findMany.mock.calls.concat(dentro.prisma.visitantes.findFirst.mock.calls);
    expect(consultas.some((c: any[]) => c[0]?.where?.codigo_acesso === '482913')).toBe(true);
    expect(consultas.some((c: any[]) => c[0]?.where?.codigo_acesso === CODIGO)).toBe(false);
    expect(dentro.client.triggerRelay).toHaveBeenCalledTimes(1);

    // Fora da janela da visita: a regra existente nega.
    const vencida = visitante({
      data_hora_inicio: new Date('2026-07-01T00:00:00.000Z'),
      data_hora_termino: new Date('2026-07-02T00:00:00.000Z'),
    });
    const fora = build({ validacao: okVisita('482913'), visitante: vencida });
    await expect(fora.svc.processWebhook('tok', leitura())).rejects.toThrow();
    expect(semAcionamento(fora.acessos).map((a) => a.evento)).toEqual(['negado']);
    expect(semAcionamento(fora.acessos)[0].face_id).toBe('cred:7');
    expect(fora.client.triggerRelay).not.toHaveBeenCalled();
  });

  it('credencial de visita abre EXATAMENTE a visita da credencial, mesmo com outra visita de mesmo PIN', async () => {
    // O PIN só é único entre visitas sem data_saida; saída por facial/tag/
    // manual não anula o PIN, então duas visitas podem ter o mesmo código.
    // B é mais nova e "pronta": pelo desempate do PIN seria a escolhida.
    const a = visitante({ id: 30, nome: 'Ana Visita' });
    const b = visitante({ id: 31, nome: 'Bruno Outro' });
    const { svc, prisma, acessos } = build({ validacao: okVisita('482913', 30), visitantes: [a, b] });

    const res = await svc.processWebhook('tok', leitura());

    expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'visitante', id: 30, evento: 'entrada' }));
    expect(semAcionamento(acessos)[0]).toEqual(
      expect.objectContaining({ face_id: 'cred:7', id_pessoa: 30, nome_pessoa: 'Ana Visita', evento: 'entrada' }),
    );
    const consultas = prisma.visitantes.findMany.mock.calls.filter((c: any[]) => c[0]?.where?.codigo_acesso === '482913');
    expect(consultas.length).toBeGreaterThan(0);
    for (const c of consultas) expect(c[0].where.id).toBe(30);
    expect(a.data_entrada).toBeInstanceOf(Date);
    expect(b.data_entrada).toBeNull();
  });

  it('credencial de visita cuja visita perdeu o PIN é negada, mesmo havendo outra visita com o mesmo PIN', async () => {
    const a = visitante({ id: 30, codigo_acesso: null });
    const b = visitante({ id: 31 });
    const { svc, acessos, client } = build({ validacao: okVisita('482913', 30), visitantes: [a, b] });

    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(/Visita encerrada/);

    expect(acessos.map((x) => x.evento)).toEqual(['negado']);
    expect(b.data_entrada).toBeNull();
    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('código P1 negado grava "negado" com o texto do motivo e face_id sem o código', async () => {
    const { svc, acessos, client } = build({ validacao: negado('expirado') });

    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow('Acesso negado: QR vencido (mostre o código atual)');

    expect(acessos).toEqual([
      expect.objectContaining({
        face_id: 'cred:7',
        tipo_pessoa: 'desconhecido',
        id_pessoa: null,
        nome_pessoa: 'QR vencido (mostre o código atual)',
        evento: 'negado',
      }),
    ]);
    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('código P1 negado não é consumido por sessão de cadastro de QR', async () => {
    const { svc, enrollSessions, acessos } = build({ validacao: negado('desconhecida'), sessaoDeCaptura: { id: 'sess-1' } });

    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(/QR não reconhecido/);

    expect(enrollSessions.consumeForDevice).not.toHaveBeenCalled();
    expect(acessos.map((a) => a.evento)).toEqual(['negado']);
  });

  it('PIN lido como QR é negado quando qr_app_habilitado está ligado', async () => {
    const { svc, acessos, validacao, prisma, client } = build({ opcao: true, visitante: visitante() });

    await expect(svc.processWebhook('tok', { qrcode: '482913' })).rejects.toThrow(/Credencial não encontrada/);

    expect(validacao.validarLeitura).not.toHaveBeenCalled();
    expect(validacao.qrAppHabilitado).toHaveBeenCalledWith(1);
    const consultas = prisma.visitantes.findMany.mock.calls.concat(prisma.visitantes.findFirst.mock.calls);
    expect(consultas.some((c: any[]) => c[0]?.where?.codigo_acesso !== undefined)).toBe(false);
    expect(acessos).toEqual([
      expect.objectContaining({ evento: 'negado', nome_pessoa: 'Não identificado ou expirado', face_id: '482913' }),
    ]);
    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('PIN lido como QR continua abrindo quando qr_app_habilitado está desligado', async () => {
    const { svc, client, validacao } = build({ opcao: false, visitante: visitante() });

    const res = await svc.processWebhook('tok', { qrcode: '482913' });

    expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'visitante', evento: 'entrada' }));
    expect(validacao.validarLeitura).not.toHaveBeenCalled();
    expect(client.triggerRelay).toHaveBeenCalledTimes(1);
  });

  it('Moradores.qrcode_acesso estático continua abrindo com a opção ligada', async () => {
    const { svc, client, acessos, validacao } = build({ opcao: true });

    const res = await svc.processWebhook('tok', { qrcode: 'QR-ANA' });

    expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'morador', id: 11, evento: 'entrada' }));
    expect(semAcionamento(acessos)[0].face_id).toBe('QR-ANA');
    expect(validacao.validarLeitura).not.toHaveBeenCalled();
    expect(client.triggerRelay).toHaveBeenCalledTimes(1);
  });

  it('evento de backlog valida contra o timestamp do evento, não contra agora', async () => {
    const { svc, validacao, client } = build();
    const quando = '2026-07-20T08:30:00.000Z';

    await svc.processWebhook('tok', leitura({ backlog: true, timestamp: quando }));

    expect(validacao.validarLeitura).toHaveBeenCalledWith(CODIGO, expect.anything(), new Date(quando));
    expect(client.triggerRelay).not.toHaveBeenCalled();
  });

  it('evento ao vivo com timestamp do aparelho valida contra agora', async () => {
    const { svc, validacao } = build();

    await svc.processWebhook('tok', leitura({ timestamp: '2026-07-20T08:30:00.000Z' }));

    expect(validacao.validarLeitura).toHaveBeenCalledWith(CODIGO, expect.anything(), AGORA);
  });

  it('11ª negação em 60 s bloqueia o leitor: validarLeitura deixa de ser chamado e só um evento de bloqueio é gravado', async () => {
    const { svc, validacao, acessos } = build({ validacao: negado('assinatura') });

    for (let i = 0; i < 10; i++) {
      await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(/QR inválido/);
      jest.advanceTimersByTime(1000);
    }
    expect(validacao.validarLeitura).toHaveBeenCalledTimes(10);
    expect(acessos).toHaveLength(10);

    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(BLOQUEIO);
    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(BLOQUEIO);
    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(BLOQUEIO);

    expect(validacao.validarLeitura).toHaveBeenCalledTimes(10);
    expect(acessos).toHaveLength(11);
    expect(acessos[10]).toEqual(
      expect.objectContaining({ evento: 'negado', nome_pessoa: BLOQUEIO, face_id: 'cred:7', tipo_pessoa: 'desconhecido' }),
    );
  });

  it('o bloqueio é por leitor e leitura válida não zera a contagem', async () => {
    const { svc, validacao, prisma } = build({ validacao: negado('assinatura') });

    for (let i = 0; i < 9; i++) {
      await expect(svc.processWebhook('tok', leitura())).rejects.toThrow();
    }
    validacao.validarLeitura.mockResolvedValueOnce(okMorador);
    await svc.processWebhook('tok', leitura());
    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(/QR inválido/); // 10ª negação
    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(BLOQUEIO);

    // Outro leitor do mesmo condomínio segue validando.
    prisma.facial_Devices.findFirst.mockResolvedValue({ ...LEITOR, id: 43 });
    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(/QR inválido/);
    expect(validacao.validarLeitura).toHaveBeenCalledTimes(12);
  });

  it('passados 60 s o leitor volta a validar', async () => {
    const { svc, validacao } = build({ validacao: negado('assinatura') });

    for (let i = 0; i < 10; i++) {
      await expect(svc.processWebhook('tok', leitura())).rejects.toThrow();
    }
    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(BLOQUEIO);
    jest.advanceTimersByTime(30_000);
    await expect(svc.processWebhook('tok', leitura())).rejects.toThrow(BLOQUEIO);
    expect(validacao.validarLeitura).toHaveBeenCalledTimes(10);

    jest.advanceTimersByTime(30_001);
    validacao.validarLeitura.mockResolvedValueOnce(okMorador);
    const res = await svc.processWebhook('tok', leitura());

    expect(res).toEqual(expect.objectContaining({ ok: true, evento: 'entrada' }));
    expect(validacao.validarLeitura).toHaveBeenCalledTimes(11);
  });

  it('nenhuma chamada de logger nem de registrarEvento recebe o código lido', async () => {
    const sujo = `  ${CODIGO.toLowerCase()}\r\n`;
    const casos = [
      build({ accessStateReal: true }),
      build({ validacao: negado('reuso') }),
      build({ validacao: okVisita(), visitante: visitante() }),
      build({ validacao: negado('desconhecida'), sessaoDeCaptura: { id: 's' } }),
    ];
    for (const c of casos) {
      const espiao = jest.spyOn(c.svc as any, 'registrarEvento');
      for (const valor of [CODIGO, sujo, CODIGO]) {
        await c.svc.processWebhook('tok', { qrcode: valor }).catch(() => undefined);
      }
      const tudo = JSON.stringify([
        espiao.mock.calls,
        c.acessos,
        Object.values(c.logger).map((fn: any) => fn.mock.calls),
      ]).toUpperCase();
      expect(tudo).not.toContain(CODIGO);
      expect(tudo).not.toContain(CODIGO.slice(2));
    }
    // O cooldown (AccessStateService real) colapsou a repetição sem imprimir o código.
    const debounce = casos[0].logger.debug.mock.calls.map((c: any[]) => String(c[0]));
    expect(debounce.some((l: string) => /cooldown/.test(l) && l.includes('cred:7'))).toBe(true);
    expect(debounce.some((l: string) => /Debounce/.test(l) && l.includes('cred:7'))).toBe(true);
  });
});
