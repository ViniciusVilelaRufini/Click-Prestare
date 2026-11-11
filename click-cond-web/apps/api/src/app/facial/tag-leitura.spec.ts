/**
 * Leitura de TAG (RFID/UHF) — do webhook até a abertura.
 *
 * Cobre o que impedia a tag de funcionar em campo:
 *  - a tabela Tags (tag do veículo) nunca era consultada;
 *  - o código era comparado por texto exato (hex do leitor x decimal impresso);
 *  - leitor configurado como "saída" nunca acionava a abertura.
 *
 * Mocks, sem banco e sem leitor.
 */
let FacialService: any;

describe('FacialService — leitura de tag', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    process.env.PESSOAS_MIGRATION_ENABLED = 'false';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => {
    jest.useRealTimers();
    delete process.env.PESSOAS_MIGRATION_ENABLED;
  });

  const LEITOR = {
    id: 42,
    id_condominio: 1,
    tipo: 'tag_reader',
    sentido: 'entrada',
    ativo: 1,
    confianca_minima: 0,
    id_area_social: null,
    nome: 'Leitor Garagem',
    webhook_token: 'tok-tag',
  };
  const PORTAO = { id: 20, id_condominio: 1, tipo: 'botoeira', ativo: 1, nome: 'Portão' };
  const PORTAO_2 = { id: 21, id_condominio: 1, tipo: 'botoeira', ativo: 1, nome: 'Portão 2' };
  const ANA = { id: 11, nome: 'Ana', tipo: 'morador', id_condominio: 1 };
  const BIA = { id: 12, nome: 'Bia', tipo: 'morador', id_condominio: 1 };

  const casa = (filtro: any, valor: string | null) => {
    if (filtro === undefined) return true;
    if (valor == null) return false;
    return typeof filtro === 'string' ? filtro === valor : filtro.in.includes(valor);
  };

  function build(opts: {
    device?: any;
    /** Moradores com tag pessoal (Moradores.tag_rfid). */
    moradores?: any[];
    /** Linhas de Tags: { id, codigo, ativo, veiculos: [{ ativo, morador }] }. */
    tags?: any[];
    visitantes?: any[];
    etapa?: any;
    regras?: any[];
    ultimoAcesso?: any;
  } = {}) {
    const device = opts.device ?? LEITOR;
    const moradores = opts.moradores ?? [];
    const filtraMoradores = ({ where }: any) =>
      moradores.filter(
        (m) =>
          (where.id === undefined || where.id === m.id) &&
          (where.tag_rfid === undefined || casa(where.tag_rfid, m.tag_rfid ?? null)),
      );
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => device),
        findMany: jest.fn(async () => [PORTAO, PORTAO_2]),
      },
      moradores: {
        findFirst: jest.fn(async (args: any) => filtraMoradores(args)[0] ?? null),
        findMany: jest.fn(async (args: any) => filtraMoradores(args)),
        findUnique: jest.fn(async ({ where }: any) => moradores.find((m) => m.id === where.id) ?? null),
      },
      tags: {
        findMany: jest.fn(async ({ where }: any) =>
          (opts.tags ?? [])
            .filter(
              (t) =>
                casa(where.codigo, t.codigo) &&
                (where.ativo === undefined || t.ativo === where.ativo),
            )
            .map((t) => ({
              ...t,
              veiculos: (t.veiculos ?? []).filter((v: any) => v.ativo === 1),
            }))
            // Só exige veículo ativo quando a consulta pede (veiculos: { some }).
            .filter((t) => where.veiculos === undefined || t.veiculos.length > 0),
        ),
      },
      visitantes: {
        findMany: jest.fn(async ({ where }: any) =>
          (opts.visitantes ?? []).filter(
            (v) =>
              casa(where.tag_rfid, v.tag_rfid ?? null) &&
              // OR = filtro de visita NÃO encerrada (sem saída, ou re-liberada).
              (where.OR === undefined || v.data_saida == null || v.liberado === 1),
          ),
        ),
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      veiculos: { findFirst: jest.fn(async () => null) },
      vagas: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
      acessos_Facial: {
        create: jest.fn(async () => ({ id: 1 })),
        findFirst: jest.fn(async () => opts.ultimoAcesso ?? null),
      },
      regras_Acesso: { findMany: jest.fn(async () => opts.regras ?? []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => opts.etapa ?? null) },
      users: { findMany: jest.fn(async () => []) },
    };
    const client: any = { triggerRelay: jest.fn(async () => ({ ok: true })) };
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
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
    return { svc, prisma, client };
  }

  const leitura = (uid: string, extra: Record<string, any> = {}) => ({
    card_uid: uid,
    timestamp: new Date('2026-07-20T10:00:00.000Z').toISOString(),
    ...extra,
  });

  const acessoGravado = (prisma: any, i = 0) => prisma.acessos_Facial.create.mock.calls[i][0].data;

  // ---------------------------------------------------------------- item 1
  describe('tag de veículo (tabela Tags)', () => {
    const tagDoCarro = (extra: any = {}) => ({
      id: 70,
      codigo: 'ABC999',
      ativo: 1,
      veiculos: [{ id: 5, ativo: 1, morador: ANA }],
      ...extra,
    });

    it('tag ativa de veículo ativo abre para o morador dono do veículo', async () => {
      const { svc, prisma, client } = build({ tags: [tagDoCarro()] });

      const res = await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(res).toEqual(expect.objectContaining({ ok: true, tipo: 'morador', id: 11, evento: 'entrada' }));
      expect(acessoGravado(prisma)).toEqual(
        expect.objectContaining({
          tipo_dispositivo: 'tag_reader',
          tipo_pessoa: 'morador',
          id_pessoa: 11,
          nome_pessoa: 'Ana',
          face_id: 'ABC999',
          evento: 'entrada',
        }),
      );
      expect(client.triggerRelay).toHaveBeenCalled();
    });

    it('consulta só tag ATIVA do condomínio com veículo ATIVO', async () => {
      const { svc, prisma } = build({ tags: [tagDoCarro()] });

      await svc.processWebhook('tok-tag', leitura('ABC999'));

      const where = prisma.tags.findMany.mock.calls[0][0].where;
      expect(where).toEqual(
        expect.objectContaining({
          id_condominio: 1,
          ativo: 1,
          veiculos: { some: { ativo: 1, id_condominio: 1 } },
        }),
      );
      expect(where.codigo.in).toContain('ABC999');
      // Defesa em profundidade (2e): o include também confere o condomínio.
      expect(prisma.tags.findMany.mock.calls[0][0].include.veiculos.where).toEqual({
        ativo: 1,
        id_condominio: 1,
      });
    });

    it('veículo cujo morador é de OUTRO condomínio não identifica ninguém (2e)', async () => {
      const { svc, client } = build({
        tags: [tagDoCarro({ veiculos: [{ id: 5, ativo: 1, morador: { ...ANA, id_condominio: 2 } }] })],
      });

      await expect(svc.processWebhook('tok-tag', leitura('ABC999'))).rejects.toThrow();
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('tag bloqueada (inativa) NÃO abre', async () => {
      const { svc, prisma, client } = build({ tags: [tagDoCarro({ ativo: 0 })] });

      await expect(svc.processWebhook('tok-tag', leitura('ABC999'))).rejects.toThrow();

      expect(acessoGravado(prisma)).toEqual(
        expect.objectContaining({ evento: 'negado', tipo_pessoa: 'desconhecido', face_id: 'ABC999' }),
      );
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('tag de veículo inativo NÃO abre', async () => {
      const { svc, client } = build({
        tags: [tagDoCarro({ veiculos: [{ id: 5, ativo: 0, morador: ANA }] })],
      });

      await expect(svc.processWebhook('tok-tag', leitura('ABC999'))).rejects.toThrow();
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    // Revisão 11/11 (2d): antes "vencia o primeiro" (a tag pessoal).
    it('código exato em tag pessoal de A e tag de veículo de B: negado por ambiguidade', async () => {
      const { svc, prisma, client } = build({
        moradores: [{ ...BIA, tag_rfid: 'ABC999' }],
        tags: [tagDoCarro()],
      });

      await expect(svc.processWebhook('tok-tag', leitura('ABC999'))).rejects.toThrow(/amb[ií]gu/i);

      expect(acessoGravado(prisma)).toEqual(expect.objectContaining({ evento: 'negado', id_pessoa: null }));
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('código exato em DOIS moradores: negado por ambiguidade (2d)', async () => {
      const { svc, client } = build({
        moradores: [
          { ...ANA, tag_rfid: 'ABC999' },
          { ...BIA, tag_rfid: 'ABC999' },
        ],
      });

      await expect(svc.processWebhook('tok-tag', leitura('ABC999'))).rejects.toThrow(/amb[ií]gu/i);
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('código exato na tag pessoal e na tag do carro da MESMA pessoa: abre', async () => {
      const { svc } = build({
        moradores: [{ ...ANA, tag_rfid: 'ABC999' }],
        tags: [tagDoCarro()],
      });

      const res = await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(res.id).toBe(11);
    });
  });

  // Revisão 11/11 (2a): "1234" lido também é hex 0x1234 = 4660 e decimal = 4D2.
  // Com a tag "1234" bloqueada, a consulta exata não achava ninguém e a
  // leitura caía na conversão — abrindo como o dono da "4660".
  describe('cadastro exato bloqueado/inativo não cai para a conversão', () => {
    it('tag bloqueada "1234" com outro morador dono da "4660": NEGADO, motivo "Tag bloqueada"', async () => {
      const { svc, prisma, client } = build({
        moradores: [{ ...BIA, tag_rfid: '4660' }],
        tags: [{ id: 70, codigo: '1234', ativo: 0, veiculos: [{ id: 5, ativo: 1, morador: ANA }] }],
      });

      await expect(svc.processWebhook('tok-tag', leitura('1234'))).rejects.toThrow(/bloquead/i);

      const gravado = acessoGravado(prisma);
      expect(gravado).toEqual(
        expect.objectContaining({ evento: 'negado', id_pessoa: null, tipo_pessoa: 'desconhecido', face_id: '1234' }),
      );
      expect(gravado.nome_pessoa).toBe('Tag bloqueada');
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('tag bloqueada "1234" com outro dono da "4D2" (decimal→hex): NEGADO', async () => {
      const { svc, client } = build({
        moradores: [{ ...BIA, tag_rfid: '4D2' }],
        tags: [{ id: 70, codigo: '1234', ativo: 0, veiculos: [{ id: 5, ativo: 1, morador: ANA }] }],
      });

      await expect(svc.processWebhook('tok-tag', leitura('1234'))).rejects.toThrow(/bloquead/i);
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('tag "1234" ativa mas SEM veículo ativo, com outro dono da "4660": NEGADO, motivo "Tag sem veículo ativo"', async () => {
      const { svc, prisma, client } = build({
        moradores: [{ ...BIA, tag_rfid: '4660' }],
        tags: [{ id: 70, codigo: '1234', ativo: 1, veiculos: [{ id: 5, ativo: 0, morador: ANA }] }],
      });

      await expect(svc.processWebhook('tok-tag', leitura('1234'))).rejects.toThrow(/sem ve[ií]culo ativo/i);

      expect(acessoGravado(prisma).nome_pessoa).toBe('Tag sem veículo ativo');
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('sem cadastro exato nenhum, a conversão única continua abrindo', async () => {
      const { svc } = build({ moradores: [{ ...BIA, tag_rfid: '4660' }] });

      const res = await svc.processWebhook('tok-tag', leitura('1234'));

      expect(res.id).toBe(12);
    });
  });

  // Revisão 11/11 (2c): tag de visitante é reaproveitada; visita encerrada não
  // é cadastro vigente e não pode tornar ambígua (nem identificar) a conversão.
  describe('2ª passada: visita encerrada não conta', () => {
    const visita = (extra: any = {}) => ({
      id: 30,
      nome: 'Vítor',
      id_condominio: 1,
      is_prestador: 0,
      liberado: 1,
      tag_rfid: '1193046',
      data_entrada: null,
      data_saida: null,
      ...extra,
    });
    const ENCERRADA = {
      liberado: 0,
      data_entrada: new Date('2026-07-01T10:00:00.000Z'),
      data_saida: new Date('2026-07-01T12:00:00.000Z'),
    };

    it('morador "1E240" + visita ENCERRADA "1193046": leitura "123456" abre para o morador', async () => {
      const { svc } = build({
        moradores: [{ ...BIA, tag_rfid: '1E240' }],
        visitantes: [visita(ENCERRADA)],
      });

      const res = await svc.processWebhook('tok-tag', leitura('123456'));

      expect(res.id).toBe(12);
    });

    it('morador "1E240" + visita VIGENTE "1193046": continua ambígua', async () => {
      const { svc } = build({
        moradores: [{ ...BIA, tag_rfid: '1E240' }],
        visitantes: [visita()],
      });

      await expect(svc.processWebhook('tok-tag', leitura('123456'))).rejects.toThrow(/amb[ií]gu/i);
    });

    it('só visita ENCERRADA com o código convertido: não identifica ninguém', async () => {
      const { svc, prisma } = build({ visitantes: [visita(ENCERRADA)] });

      await expect(svc.processWebhook('tok-tag', leitura('123456'))).rejects.toThrow();

      expect(acessoGravado(prisma)).toEqual(
        expect.objectContaining({ evento: 'negado', tipo_pessoa: 'desconhecido', id_pessoa: null }),
      );
    });
  });

  // ---------------------------------------------------------------- item 2
  describe('código normalizado e variantes', () => {
    it('leitor manda hex e o cadastro do morador está em decimal: casa', async () => {
      const { svc } = build({ moradores: [{ ...ANA, tag_rfid: '12345678' }] });

      const res = await svc.processWebhook('tok-tag', leitura('BC614E'));

      expect(res).toEqual(expect.objectContaining({ tipo: 'morador', id: 11 }));
    });

    it('leitor manda decimal com zeros e a tag do veículo está em hex: casa', async () => {
      const { svc } = build({
        tags: [{ id: 70, codigo: 'BC614E', ativo: 1, veiculos: [{ id: 5, ativo: 1, morador: ANA }] }],
      });

      const res = await svc.processWebhook('tok-tag', leitura('0012345678'));

      expect(res).toEqual(expect.objectContaining({ tipo: 'morador', id: 11 }));
    });

    it('cadastro antigo NÃO normalizado continua casando pelo texto bruto', async () => {
      const { svc } = build({ moradores: [{ ...ANA, tag_rfid: 'bc-61-4e' }] });

      const res = await svc.processWebhook('tok-tag', leitura(' bc-61-4e '));

      expect(res.id).toBe(11);
    });

    it('visitante: a consulta usa as variantes (tag_rfid IN ...)', async () => {
      const { svc, prisma } = build({});

      await expect(svc.processWebhook('tok-tag', leitura('BC614E'))).rejects.toThrow();

      const filtros = prisma.visitantes.findMany.mock.calls.map((c: any) => c[0].where.tag_rfid.in);
      expect(filtros[0]).toContain('BC614E');
      expect(filtros.flat()).toContain('12345678');
    });

    // "123456" pode ser decimal (= hex 1E240) ou hex (= decimal 1193046).
    it('igualdade exata tem prioridade sobre conversão de base', async () => {
      const { svc } = build({
        moradores: [
          { ...BIA, tag_rfid: '1E240' },
          { ...ANA, tag_rfid: '123456' },
        ],
      });

      const res = await svc.processWebhook('tok-tag', leitura('123456'));

      expect(res.id).toBe(11);
    });

    it('conversão que casa com MAIS de um cadastro é negada por ambiguidade', async () => {
      const { svc, prisma, client } = build({
        moradores: [{ ...BIA, tag_rfid: '1E240' }],
        tags: [{ id: 70, codigo: '1193046', ativo: 1, veiculos: [{ id: 5, ativo: 1, morador: ANA }] }],
      });

      await expect(svc.processWebhook('tok-tag', leitura('123456'))).rejects.toThrow(/amb[ií]gu/i);

      const gravado = acessoGravado(prisma);
      expect(gravado).toEqual(
        expect.objectContaining({ evento: 'negado', id_pessoa: null, face_id: '123456' }),
      );
      expect(gravado.nome_pessoa).toMatch(/amb[ií]gu/i);
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('a mesma pessoa pelos dois caminhos (tag pessoal + tag do carro) não é ambiguidade', async () => {
      const { svc } = build({
        moradores: [{ ...ANA, tag_rfid: '1E240' }],
        tags: [{ id: 70, codigo: '1193046', ativo: 1, veiculos: [{ id: 5, ativo: 1, morador: ANA }] }],
      });

      const res = await svc.processWebhook('tok-tag', leitura('123456'));

      expect(res.id).toBe(11);
    });

    it('conversão única (um só cadastro) abre', async () => {
      const { svc } = build({ moradores: [{ ...BIA, tag_rfid: '1E240' }] });

      const res = await svc.processWebhook('tok-tag', leitura('123456'));

      expect(res.id).toBe(12);
    });
  });

  // ---------------------------------------------------------------- item 3
  // "Leitor em auto não alterna" (e fica fora do anti-passback por histórico)
  // está coberto em leitor-sem-direcao.spec.ts. Aqui ficam os comportamentos
  // vizinhos que continuam valendo.
  describe('sentido do leitor', () => {
    const AUTO = { ...LEITOR, sentido: 'auto' };
    const moradores = [{ ...ANA, tag_rfid: 'ABC999' }];
    const ultimoAcesso = { evento: 'entrada', timestamp: new Date('2026-07-20T09:00:00.000Z') };

    it('leitor em "auto" respeita a direção quando o payload informa', async () => {
      const { svc } = build({ device: AUTO, moradores, ultimoAcesso });

      const res = await svc.processWebhook('tok-tag', leitura('ABC999', { direction: 'out' }));

      expect(res.evento).toBe('saida');
    });

    it('leitor configurado como "saida" continua saída', async () => {
      const { svc } = build({ device: { ...LEITOR, sentido: 'saida' }, moradores, ultimoAcesso });

      const res = await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(res.evento).toBe('saida');
    });

    it('terminal FACIAL em "auto" continua alternando pelo último acesso', async () => {
      const { svc } = build({
        device: { ...AUTO, tipo: 'facial' },
        moradores: [ANA],
        ultimoAcesso,
      });

      const res = await svc.processWebhook('tok-tag', {
        external_id: 'morador_11',
        timestamp: new Date('2026-07-20T10:00:00.000Z').toISOString(),
      });

      expect(res.evento).toBe('saida');
    });
  });

  // ---------------------------------------------------------------- item 4
  describe('ponte: leitor configurado como saída', () => {
    const SAIDA = { ...LEITOR, sentido: 'saida' };
    const moradores = [{ ...ANA, tag_rfid: 'ABC999' }];
    const ultimoAcesso = { evento: 'entrada', timestamp: new Date('2026-07-20T09:00:00.000Z') };
    const regra = (sentido: string, dispositivos: any[]) => ({
      id: 1,
      sentido,
      hora_inicio: null,
      hora_fim: null,
      permitir_morador: 1,
      permitir_visitante: 1,
      permitir_prestador: 1,
      permitir_funcionario: 1,
      dispositivos: dispositivos.map((d) => ({ id_dispositivo: d.id, dispositivo: d })),
    });

    it('saída em etapa de caminho com abertura: aciona SÓ a abertura da etapa', async () => {
      const { svc, client } = build({
        device: SAIDA,
        moradores,
        ultimoAcesso,
        etapa: { id: 1, ordem: 1, id_leitor: 42, abertura: PORTAO, caminho: { nome: 'Saída' } },
      });

      const res = await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(res.evento).toBe('saida');
      expect(client.triggerRelay).toHaveBeenCalledTimes(1);
      expect(client.triggerRelay).toHaveBeenCalledWith(expect.objectContaining({ id: 20 }));
    });

    it('saída em etapa SEM abertura não aciona nada', async () => {
      const { svc, client } = build({
        device: SAIDA,
        moradores,
        ultimoAcesso,
        etapa: { id: 1, ordem: 1, id_leitor: 42, abertura: null, caminho: { nome: 'Saída' } },
      });

      await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('saída com leitor mapeado em regra de acesso: aciona a abertura da regra', async () => {
      const { svc, client } = build({
        device: SAIDA,
        moradores,
        ultimoAcesso,
        regras: [regra('ambos', [SAIDA, PORTAO_2])],
      });

      await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(client.triggerRelay).toHaveBeenCalledTimes(1);
      expect(client.triggerRelay).toHaveBeenCalledWith(expect.objectContaining({ id: 21 }));
    });

    it('saída NÃO usa mapeamento de regra que é só de entrada', async () => {
      const { svc, client } = build({
        device: SAIDA,
        moradores,
        ultimoAcesso,
        regras: [regra('saida', [SAIDA]), regra('entrada', [SAIDA, PORTAO_2])],
      });

      const res = await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(res.evento).toBe('saida');
      expect(client.triggerRelay).not.toHaveBeenCalled();
    });

    it('saída SEM caminho e SEM regra não cai no "abre tudo" (exclusivo de entrada)', async () => {
      const { svc, prisma, client } = build({ device: SAIDA, moradores, ultimoAcesso });

      const res = await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(res.evento).toBe('saida');
      expect(client.triggerRelay).not.toHaveBeenCalled();
      expect(prisma.facial_Devices.findMany).not.toHaveBeenCalled();
    });

    it('entrada sem mapeamento mantém o fallback que aciona todas as aberturas', async () => {
      const { svc, client } = build({ moradores });

      await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(client.triggerRelay).toHaveBeenCalledTimes(2);
    });

    it('saída vinda do backlog não aciona abertura', async () => {
      const { svc, client } = build({
        device: SAIDA,
        moradores,
        ultimoAcesso,
        etapa: { id: 1, ordem: 1, id_leitor: 42, abertura: PORTAO, caminho: { nome: 'Saída' } },
      });

      await svc.processWebhook('tok-tag', leitura('ABC999', { backlog: true }));

      expect(client.triggerRelay).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- item 6
  describe('timestamp do payload', () => {
    it('timestamp inválido usa a hora de chegada em vez de gravar data inválida', async () => {
      const { svc, prisma } = build({ moradores: [{ ...ANA, tag_rfid: 'ABC999' }] });
      const antes = Date.now();

      await svc.processWebhook('tok-tag', { card_uid: 'ABC999', timestamp: 'não-é-data' });

      const ts: Date = acessoGravado(prisma).timestamp;
      expect(Number.isNaN(ts.getTime())).toBe(false);
      expect(Math.abs(ts.getTime() - antes)).toBeLessThan(5000);
    });

    it('timestamp válido é respeitado', async () => {
      const { svc, prisma } = build({ moradores: [{ ...ANA, tag_rfid: 'ABC999' }] });

      await svc.processWebhook('tok-tag', leitura('ABC999'));

      expect(acessoGravado(prisma).timestamp.toISOString()).toBe('2026-07-20T10:00:00.000Z');
    });
  });
});
