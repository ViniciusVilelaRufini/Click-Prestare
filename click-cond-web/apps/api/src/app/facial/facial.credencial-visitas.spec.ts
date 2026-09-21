/**
 * Lote B — Critical 1: `codigo_acesso`/`tag_rfid` moraram para `Visitas` na
 * migração Pessoas/Visitas, mas `findVisitanteByCredencial` (o único
 * resolvedor de PIN/tag no webhook) só olhava `Visitantes` — sem checagem de
 * flag nenhuma. Com PESSOAS_MIGRATION_ENABLED=true, um visitante com PIN/tag
 * legítimo era recebido como "credencial não encontrada" e negado.
 *
 * `resolverVisitantePorCredencial` faz o dispatch pela flag; ligada, usa
 * `findVisitaByCredencial` (`prisma.visitas`) e NUNCA `prisma.visitantes`.
 *
 * Dormente hoje só porque `Facial_Devices` está vazia em produção — o
 * primeiro leitor de tag/QR instalado torna isso ativo.
 */
let FacialService: any;

describe('FacialService — webhook, credencial (PIN/tag) em Visitas (Lote B, Critical 1)', () => {
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

  function buildService(prisma: any) {
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => ({ ok: true })),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const svc = new FacialService(
      prisma,
      {} as any, // client (device)
      { sendPushNotification: jest.fn() } as any, // notifications
      { consumeForDevice: jest.fn(() => null) } as any, // enrollSessions
      { registrar: jest.fn() } as any, // auditoria
      accessState,
      {} as any, // agent
    );
    return { svc, accessState };
  }

  const DEVICE_TAG = {
    id: 1,
    id_condominio: 1,
    tipo: 'tag_reader',
    sentido: 'entrada',
    ativo: 1,
    confianca_minima: 0,
    nome: 'Leitor Tag',
    webhook_token: 'tok-tag',
  };
  const DEVICE_QR = {
    id: 2,
    id_condominio: 1,
    tipo: 'qrcode_reader',
    sentido: 'entrada',
    ativo: 1,
    confianca_minima: 0,
    nome: 'Leitor QR',
    webhook_token: 'tok-qr',
  };

  const pessoaAtiva = (id: number) => {
    const agora = Date.now();
    const visita = {
      id: 500 + id,
      id_pessoa: id,
      id_condominio: 1,
      is_prestador: 0,
      liberado: 1,
      bloqueado: 0,
      tag_rfid: 'TAG-1',
      codigo_acesso: '654321',
      data_hora_inicio: new Date(agora - 60_000),
      data_hora_termino: new Date(agora + 3_600_000),
      data_entrada: null,
      data_saida: null,
      dias_semana: null,
      pessoa: { id, nome: 'Fulano de Visitas' },
    };
    return {
      pessoa: {
        id,
        nome: 'Fulano de Visitas',
        bloqueado: 0,
        tipo_pessoa: 'visitante',
        visitas: [visita],
      },
      visita,
    };
  };

  function buildPrisma(opts: { visitasCandidatos?: any[]; pessoa?: any } = {}) {
    const visitantesDelegate = jest.fn(); // NUNCA deve ser chamado com a flag ON

    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(),
        findMany: jest.fn(async () => []), // ponte: sem aberturas a acionar
      },
      moradores: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
      },
      visitantes: {
        findUnique: visitantesDelegate,
        findFirst: visitantesDelegate,
        findMany: visitantesDelegate,
        update: visitantesDelegate,
        updateMany: visitantesDelegate,
      },
      visitas: {
        findMany: jest.fn(async () => opts.visitasCandidatos ?? []),
        findFirst: jest.fn(async () => null), // usado na alternância "auto"
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      pessoas: {
        findUnique: jest.fn(async ({ where, include }: any) => {
          if (!opts.pessoa || where.id !== opts.pessoa.id) return null;
          return include?.visitas ? opts.pessoa : { ...opts.pessoa, visitas: undefined };
        }),
      },
      regras_Acesso: { findMany: jest.fn(async () => []) },
      caminhos_Etapas: { findFirst: jest.fn(async () => null) },
      acessos_Facial: {
        create: jest.fn(async () => ({ id: 1 })),
        findFirst: jest.fn(async () => null),
      },
      vagas: { count: jest.fn(async () => 0) },
      users: { findMany: jest.fn(async () => []) },
    };
    return { prisma, visitantesDelegate };
  }

  describe('flag ON', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    it('uma tag RFID gravada em Visitas é encontrada e nunca consulta prisma.visitantes', async () => {
      const { pessoa, visita } = pessoaAtiva(77);
      const { prisma, visitantesDelegate } = buildPrisma({
        visitasCandidatos: [visita],
        pessoa,
      });
      prisma.facial_Devices.findFirst.mockResolvedValue(DEVICE_TAG);
      const { svc } = buildService(prisma);

      await svc.processWebhook('tok-tag', {
        event: 'entrada',
        external_id: 'TAG-1',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.visitas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tag_rfid: 'TAG-1', id_condominio: 1 }),
        }),
      );
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: visita.id }) }),
      );
      expect(visitantesDelegate).not.toHaveBeenCalled();
    });

    it('um PIN (codigo_acesso) gravado em Visitas é encontrado e nunca consulta prisma.visitantes', async () => {
      const { pessoa, visita } = pessoaAtiva(88);
      const { prisma, visitantesDelegate } = buildPrisma({
        visitasCandidatos: [visita],
        pessoa,
      });
      prisma.facial_Devices.findFirst.mockResolvedValue(DEVICE_QR);
      const { svc } = buildService(prisma);

      await svc.processWebhook('tok-qr', {
        event: 'entrada',
        external_id: '654321',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.visitas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ codigo_acesso: '654321', id_condominio: 1 }),
        }),
      );
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: visita.id }) }),
      );
      expect(visitantesDelegate).not.toHaveBeenCalled();
    });

    it('duas Visitas com a MESMA credencial (uma revogada, uma ativa): resolve para a ativa e NÃO reeleje via Pessoas', async () => {
      const agora = Date.now();
      const pessoaId = 99;
      const visitaRevogada = {
        id: 701,
        id_pessoa: pessoaId,
        id_condominio: 1,
        id_apartamento: 101,
        is_prestador: 0,
        liberado: 0, // expirada/revogada — mas tag_rfid continua igual (atualizarPessoa grava em todas)
        bloqueado: 0,
        tag_rfid: 'TAG-MULTI',
        codigo_acesso: null,
        data_hora_inicio: new Date(agora - 7_200_000),
        data_hora_termino: new Date(agora - 3_600_000),
        data_entrada: null,
        data_saida: null,
        dias_semana: null,
        pessoa: { id: pessoaId, nome: 'Fulano Multi', bloqueado: 0 },
      };
      const visitaAtiva = {
        id: 702,
        id_pessoa: pessoaId,
        id_condominio: 1,
        id_apartamento: 101,
        is_prestador: 0,
        liberado: 1,
        bloqueado: 0,
        tag_rfid: 'TAG-MULTI',
        codigo_acesso: null,
        data_hora_inicio: new Date(agora - 60_000),
        data_hora_termino: new Date(agora + 3_600_000),
        data_entrada: null,
        data_saida: null,
        dias_semana: null,
        pessoa: { id: pessoaId, nome: 'Fulano Multi', bloqueado: 0 },
      };
      const pessoa = {
        id: pessoaId,
        nome: 'Fulano Multi',
        bloqueado: 0,
        tipo_pessoa: 'visitante',
        visitas: [visitaRevogada, visitaAtiva],
      };
      const { prisma } = buildPrisma({
        visitasCandidatos: [visitaRevogada, visitaAtiva],
        pessoa,
      });
      prisma.facial_Devices.findFirst.mockResolvedValue(DEVICE_TAG);
      const { svc } = buildService(prisma);

      await svc.processWebhook('tok-tag', {
        event: 'entrada',
        external_id: 'TAG-MULTI',
        timestamp: new Date().toISOString(),
      });

      // A visita ATIVA (702) é a que abre a porta — não a revogada (701).
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 702 }) }),
      );
      // `pessoas.findUnique` só é chamado aqui pelo re-sync em background
      // pós-entrada (`syncPessoa`) — nunca ANTES do updateMany, que é onde a
      // reeleição bugada consultava Pessoas para decidir qual Visita abre a
      // porta. Confirma que a decisão em si não reconsultou Pessoas.
      const ordemUpdateMany = prisma.visitas.updateMany.mock.invocationCallOrder[0];
      const ordensFindUnique = prisma.pessoas.findUnique.mock.invocationCallOrder;
      expect(ordensFindUnique.every((o: number) => o > ordemUpdateMany)).toBe(true);
    });

    it('saída: pessoa está DENTRO por uma Visita, mas tem outra mais antiga não usada — saída resolve para quem está dentro', async () => {
      const agora = Date.now();
      const pessoaId = 55;
      const visitaAntigaNaoUsada = {
        id: 801,
        id_pessoa: pessoaId,
        id_condominio: 1,
        id_apartamento: 101,
        is_prestador: 0,
        liberado: 1,
        bloqueado: 0,
        tag_rfid: 'TAG-EXIT',
        codigo_acesso: null,
        data_hora_inicio: new Date(agora - 3 * 3_600_000),
        data_hora_termino: new Date(agora + 3_600_000), // janela ainda válida — .find() sem orderBy a elegeria primeiro
        data_entrada: null,
        data_saida: null,
        dias_semana: null,
        pessoa: { id: pessoaId, nome: 'Fulano Dentro', bloqueado: 0 },
      };
      const visitaDentro = {
        id: 802,
        id_pessoa: pessoaId,
        id_condominio: 1,
        id_apartamento: 101,
        is_prestador: 0,
        liberado: 1,
        bloqueado: 0,
        tag_rfid: 'TAG-EXIT',
        codigo_acesso: null,
        data_hora_inicio: new Date(agora - 3_600_000),
        data_hora_termino: new Date(agora + 3_600_000),
        data_entrada: new Date(agora - 1_800_000), // entrou há 30min, ainda não saiu
        data_saida: null,
        dias_semana: null,
        pessoa: { id: pessoaId, nome: 'Fulano Dentro', bloqueado: 0 },
      };
      const pessoa = {
        id: pessoaId,
        nome: 'Fulano Dentro',
        bloqueado: 0,
        tipo_pessoa: 'visitante',
        // A antiga não-usada vem PRIMEIRO — é o cenário que a reeleição
        // (`.find()` sem `orderBy`) escolheria errado no código antigo.
        visitas: [visitaAntigaNaoUsada, visitaDentro],
      };
      const { prisma } = buildPrisma({
        visitasCandidatos: [visitaAntigaNaoUsada, visitaDentro],
        pessoa,
      });
      prisma.facial_Devices.findFirst.mockResolvedValue({ ...DEVICE_TAG, sentido: 'saida' });
      const { svc } = buildService(prisma);

      await svc.processWebhook('tok-tag', {
        event: 'saida',
        external_id: 'TAG-EXIT',
        timestamp: new Date().toISOString(),
      });

      // Não foi negado: a saída encontrou a Visita que está DENTRO (802), não a antiga (801).
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 802 }) }),
      );
      // Mesma checagem de ordem do teste acima: `pessoas.findUnique` só
      // aparece (se aparecer) pelo re-sync em background pós-saída, depois
      // da decisão de qual Visita sai.
      const ordemUpdateMany = prisma.visitas.updateMany.mock.invocationCallOrder[0];
      const ordensFindUnique = prisma.pessoas.findUnique.mock.invocationCallOrder;
      expect(ordensFindUnique.every((o: number) => o > ordemUpdateMany)).toBe(true);
    });
  });

  describe('flag OFF (default) — continua resolvendo contra Visitantes', () => {
    beforeEach(() => {
      delete process.env['PESSOAS_MIGRATION_ENABLED'];
    });

    it('tag RFID é resolvida via prisma.visitantes, e prisma.visitas nunca é consultado para identidade', async () => {
      const agora = Date.now();
      const visitasDelegate = jest.fn();
      const prisma: any = {
        isConnected: true,
        facial_Devices: { findFirst: jest.fn(async () => DEVICE_TAG), findMany: jest.fn(async () => []) },
        moradores: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
        visitantes: (() => {
          const visitanteLegado = {
            id: 10,
            nome: 'Legado',
            is_prestador: 0,
            liberado: 1,
            bloqueado: 0,
            tag_rfid: 'TAG-1',
            data_hora_inicio: new Date(agora - 60_000),
            data_hora_termino: new Date(agora + 3_600_000),
            data_entrada: null,
            data_saida: null,
            dias_semana: null,
            id_condominio: 1,
            id_apartamento: 101,
          };
          return {
            findMany: jest.fn(async () => [visitanteLegado]),
            findUnique: jest.fn(async ({ where }: any) =>
              where.id === 10 ? visitanteLegado : null,
            ),
            updateMany: jest.fn(async () => ({ count: 1 })),
          };
        })(),
        visitas: {
          findMany: visitasDelegate,
          findFirst: visitasDelegate,
          updateMany: visitasDelegate,
        },
        pessoas: { findUnique: visitasDelegate },
        regras_Acesso: { findMany: jest.fn(async () => []) },
        caminhos_Etapas: { findFirst: jest.fn(async () => null) },
        acessos_Facial: { create: jest.fn(async () => ({ id: 1 })), findFirst: jest.fn(async () => null) },
        vagas: { count: jest.fn(async () => 0) },
        users: { findMany: jest.fn(async () => []) },
      };
      const { svc } = buildService(prisma);

      await svc.processWebhook('tok-tag', {
        event: 'entrada',
        external_id: 'TAG-1',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.visitantes.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 10 }) }),
      );
      expect(visitasDelegate).not.toHaveBeenCalled();
    });
  });

  /**
   * Critical follow-up (Lote B, pós-Critical 1): num terminal `sentido:
   * 'auto'` (default do schema — caso real dos faciais Intelbras/Dahua), a
   * credencial era resolvida/desempatada com o palpite INICIAL de `evento`
   * (sempre 'entrada' quando o payload não traz direção) — mas o bloco
   * `isAmbiguousAuto`, que roda DEPOIS, podia reclassificar para 'saida' com
   * base no estado real da pessoa. `visitaResolvidaPorCredencial` ficava
   * então desempatada para o sentido ERRADO: uma pessoa DENTRO era negada por
   * "não possui uma entrada ativa" na Visita ainda não usada, em vez de dar
   * baixa na Visita em que ela de fato está.
   */
  describe('sentido "auto": evento reclassificado após a credencial já ter sido resolvida', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    const DEVICE_TAG_AUTO = { ...DEVICE_TAG, sentido: 'auto' };

    it('pessoa DENTRO apresenta a tag: reresolve e dá saída na Visita correta (não nega por falta de entrada)', async () => {
      const agora = Date.now();
      const idPessoa = 66;
      const visitaNaoUsada = {
        id: 901,
        id_pessoa: idPessoa,
        id_condominio: 1,
        id_apartamento: 101,
        is_prestador: 0,
        liberado: 1,
        bloqueado: 0,
        tag_rfid: 'TAG-AUTO',
        codigo_acesso: null,
        data_hora_inicio: new Date(agora - 3_600_000),
        data_hora_termino: new Date(agora + 3_600_000),
        data_entrada: null,
        data_saida: null,
        dias_semana: null,
        pessoa: { id: idPessoa, nome: 'Fulano Auto', bloqueado: 0 },
      };
      const visitaDentro = {
        id: 902,
        id_pessoa: idPessoa,
        id_condominio: 1,
        id_apartamento: 101,
        is_prestador: 0,
        liberado: 1,
        bloqueado: 0,
        tag_rfid: 'TAG-AUTO',
        codigo_acesso: null,
        data_hora_inicio: new Date(agora - 3_600_000),
        data_hora_termino: new Date(agora + 3_600_000),
        data_entrada: new Date(agora - 1_800_000), // entrou há 30min, ainda não saiu
        data_saida: null,
        dias_semana: null,
        pessoa: { id: idPessoa, nome: 'Fulano Auto', bloqueado: 0 },
      };
      const { prisma } = buildPrisma({
        visitasCandidatos: [visitaNaoUsada, visitaDentro],
      });
      prisma.facial_Devices.findFirst.mockResolvedValue(DEVICE_TAG_AUTO);
      // Checagem "dentroAgora" do isAmbiguousAuto: a pessoa está de fato dentro.
      prisma.visitas.findFirst.mockResolvedValue(visitaDentro);
      const { svc } = buildService(prisma);

      // Sem `direction` e sem palavra de entrada/saída no `event` — mesmo
      // formato ambíguo usado no teste de Critical 3 — para exercitar o
      // palpite inicial 'entrada' seguido do flip para 'saida'.
      await svc.processWebhook('tok-tag', {
        event: 'access',
        external_id: 'TAG-AUTO',
        timestamp: new Date().toISOString(),
      });

      // Prova da reresolução: `findVisitaByCredencial` (via
      // `prisma.visitas.findMany`) foi chamado 2x — uma vez com o palpite
      // inicial ('entrada'), outra com o evento final ('saida').
      expect(prisma.visitas.findMany).toHaveBeenCalledTimes(2);

      // A saída baixa a Visita em que a pessoa está DENTRO (902) — não a
      // ainda não usada (901), que não tem `data_entrada` e teria sido
      // negada por "não possui uma entrada ativa".
      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 902,
            data_entrada: expect.anything(),
            data_saida: null,
          }),
          data: expect.objectContaining({ data_saida: expect.any(Date) }),
        }),
      );
    });

    it('pessoa FORA apresenta a tag: evento permanece "entrada", sem reresolução (comportamento preexistente intacto)', async () => {
      const agora = Date.now();
      const idPessoa = 67;
      const visitaNaoUsada = {
        id: 903,
        id_pessoa: idPessoa,
        id_condominio: 1,
        id_apartamento: 101,
        is_prestador: 0,
        liberado: 1,
        bloqueado: 0,
        tag_rfid: 'TAG-AUTO-2',
        codigo_acesso: null,
        data_hora_inicio: new Date(agora - 60_000),
        data_hora_termino: new Date(agora + 3_600_000),
        data_entrada: null,
        data_saida: null,
        dias_semana: null,
        pessoa: { id: idPessoa, nome: 'Fulano Fora', bloqueado: 0 },
      };
      const { prisma } = buildPrisma({
        visitasCandidatos: [visitaNaoUsada],
      });
      prisma.facial_Devices.findFirst.mockResolvedValue(DEVICE_TAG_AUTO);
      // Ninguém dentro (findFirst da checagem "dentroAgora" não acha nada) e
      // sem histórico em Acessos_Facial (mock default já retorna null) — a
      // alternância cai para 'entrada', igual ao palpite inicial.
      prisma.visitas.findFirst.mockResolvedValue(null);
      const { svc } = buildService(prisma);

      await svc.processWebhook('tok-tag', {
        event: 'access',
        external_id: 'TAG-AUTO-2',
        timestamp: new Date().toISOString(),
      });

      // Sem flip de evento, não há reresolução: findMany chamado 1x só.
      expect(prisma.visitas.findMany).toHaveBeenCalledTimes(1);

      expect(prisma.visitas.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 903, liberado: 1 }),
          data: expect.objectContaining({ data_entrada: expect.any(Date) }),
        }),
      );
    });
  });
});
