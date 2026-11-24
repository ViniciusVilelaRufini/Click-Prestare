/**
 * Terminal de área social com reserva obrigatória — varredura 24/11.
 *
 * F1: o terminal guarda UMA janela por pessoa; a janela gravada é sempre a da
 *     reserva aprovada vigente ou próxima do apto (reservaVigenteOuProxima),
 *     não a da reserva que disparou o sync.
 * Q3: syncs do mesmo (área, apto) são serializados pelo lock
 *     `area:<idArea>:apto:<idApto>` e releem tudo dentro dele; o que falha no
 *     terminal fica marcado e o tickReservasAreas refaz (inclusive de reserva
 *     já apagada).
 * F1/reconcile: "hoje" de Brasília e syncs aguardados em sequência.
 * F5: morador excluído sai dos terminais de área mesmo sem face_id.
 * F6: tag/QR no terminal da área só passa morador com reserva vigente agora.
 *
 * Mocks, sem banco e sem aparelho.
 */
let FacialService: any;

const DEVICE = { id: 9, id_condominio: 1, id_area_social: 3, tipo: 'facial', ativo: 1 };
const ANA = {
  id: 11,
  id_user: 111,
  nome: 'Ana',
  foto_pessoa: 'https://s3/ana.jpg',
  face_id: null,
  id_condominio: 1,
  tipo: 'morador',
};

/** Reserva aprovada de 20/07/2026 do apto 50 na área 3 (horas = relógio de Brasília). */
const reserva = (id: number, de: string, ate: string, extra: any = {}) => ({
  id,
  id_area_social: 3,
  id_apartamento: 50,
  data: new Date('2026-07-20T00:00:00.000Z'),
  hora_de: new Date(`1970-01-01T${de}:00.000Z`),
  hora_ate: new Date(`1970-01-01T${ate}:00.000Z`),
  status: 'aprovado',
  area: { id_condominio: 1, controle_acesso_facial: 1 },
  ...extra,
});

/** GET_LOCK/RELEASE_LOCK de verdade (fila por nome), como o MySQL faz entre sessões. */
function prismaComLock(base: any) {
  const donos = new Map<string, Promise<void>>();
  const liberar = new Map<string, () => void>();
  const nomesPedidos: string[] = [];
  base.$transaction = jest.fn(async (fn: any) =>
    fn({
      $queryRaw: async (strings: TemplateStringsArray, nome: string) => {
        const sql = strings.join('?');
        if (sql.includes('GET_LOCK')) {
          nomesPedidos.push(nome);
          while (donos.has(nome)) await donos.get(nome);
          let soltar!: () => void;
          donos.set(nome, new Promise<void>((r) => (soltar = r)));
          liberar.set(nome, soltar);
          return [{ ok: 1 }];
        }
        if (sql.includes('RELEASE_LOCK')) {
          donos.delete(nome);
          liberar.get(nome)?.();
          return [{ ok: 1 }];
        }
        return [];
      },
    }),
  );
  return nomesPedidos;
}

describe('FacialService — terminal de área com reserva obrigatória (F1, Q3, F5)', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });
  afterAll(() => jest.useRealTimers());

  function build(opts: { reservas: any[]; porId?: Record<number, any> }) {
    const client = {
      enrollPerson: jest.fn(async () => ({ faceId: 'x' })),
      removePerson: jest.fn(async () => true),
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais: {
        findUnique: jest.fn(async () => ({ id: 3, id_condominio: 1, controle_acesso_facial: 1 })),
      },
      areas_Sociais_Agendamentos: {
        findUnique: jest.fn(async ({ where }: any) => opts.porId?.[where.id] ?? opts.reservas.find((r) => r.id === where.id) ?? null),
        // Aprovadas do apto (o service ordena por data/hora no banco; aqui já vêm em ordem).
        findMany: jest.fn(async () => opts.reservas.filter((r) => r.status === 'aprovado')),
      },
      facial_Devices: { findMany: jest.fn(async () => [DEVICE]) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_user: 111, id_apto: 50 }]) },
      moradores: { findMany: jest.fn(async () => [ANA]) },
    };
    const consentimentos = { autorizouBiometria: jest.fn(async () => true) };
    const svc = new FacialService(prisma, client as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, consentimentos as any, {} as any);
    jest.spyOn(svc as any, 'fetchPhotoAsBase64').mockResolvedValue('BASE64');
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    return { svc, prisma, client };
  }

  describe('F1 — uma janela por pessoa: a da reserva vigente ou próxima', () => {
    const MANHA = reserva(100, '10:00', '12:00');
    const NOITE = reserva(101, '19:00', '21:00');

    it('às 13h, sincronizar a reserva da manhã (já terminada) grava a janela da noite', async () => {
      jest.setSystemTime(new Date('2026-07-20T16:00:00.000Z')); // 13:00 em Brasília
      const { svc, client } = build({ reservas: [MANHA, NOITE] });
      await svc.syncReservaArea(100);
      expect(client.enrollPerson).toHaveBeenCalledTimes(1);
      expect(client.enrollPerson.mock.calls[0][1]).toEqual(
        expect.objectContaining({ validFrom: '2026-07-20 19:00:00', validTo: '2026-07-20 21:00:00' }),
      );
    });

    it('às 9h, aprovar a da noite não tira a janela da manhã (que vem antes)', async () => {
      jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z')); // 09:00 em Brasília
      const { svc, client } = build({ reservas: [MANHA, NOITE] });
      await svc.syncReservaArea(101);
      expect(client.enrollPerson.mock.calls[0][1]).toEqual(
        expect.objectContaining({ validFrom: '2026-07-20 10:00:00', validTo: '2026-07-20 12:00:00' }),
      );
    });

    it('o tick faz um sync por apto (duas reservas do mesmo apto hoje = um enroll)', async () => {
      jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
      const { svc, client } = build({ reservas: [MANHA, NOITE] });
      await (svc as any).tickReservasAreas();
      expect(client.enrollPerson).toHaveBeenCalledTimes(1);
      expect(client.enrollPerson.mock.calls[0][1].validFrom).toBe('2026-07-20 10:00:00');
    });

    it('reconcile às 22h30 de Brasília busca reservas desde HOJE em Brasília e aguarda os syncs', async () => {
      jest.setSystemTime(new Date('2026-07-21T01:30:00.000Z')); // 20/07 22:30 em Brasília
      const TARDE_NOITE = reserva(102, '22:00', '00:00');
      const { svc, prisma, client } = build({ reservas: [TARDE_NOITE] });
      prisma.areas_Sociais.findUnique = jest.fn(async () => ({ id: 3, id_condominio: 1, controle_acesso_facial: 1 }));
      prisma.moradores.findMany = jest.fn(async (args: any) =>
        args?.select?.tipo ? [{ id: 11, face_id: null, tipo: 'morador' }] : [ANA],
      );
      prisma.prestadores_servico = { findMany: jest.fn(async () => []) };

      await svc.reconcileAreaGating(3);

      const where = prisma.areas_Sociais_Agendamentos.findMany.mock.calls[0][0].where;
      expect(where.data).toEqual({ gte: new Date('2026-07-20') });
      // Aguardado: quando o reconcile volta, a pessoa já foi enrolada com a janela até a meia-noite.
      expect(client.enrollPerson).toHaveBeenCalledWith(
        DEVICE,
        expect.objectContaining({ validFrom: '2026-07-20 22:00:00', validTo: '2026-07-21 00:00:00' }),
      );
      expect(client.removePerson).not.toHaveBeenCalled();
    });
  });

  describe('Q3 — syncs do mesmo apto serializados e remoção que falhou é refeita', () => {
    it('aprovar e logo recusar: o sync da recusa espera o da aprovação e o terminal termina SEM o rosto', async () => {
      jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
      const ag = reserva(100, '14:00', '18:00');
      const { svc, prisma, client } = build({ reservas: [ag] });
      const nomes = prismaComLock(prisma);
      // A foto da aprovação demora; nesse meio tempo a reserva é recusada.
      let soltarFoto!: (v: string) => void;
      (svc as any).fetchPhotoAsBase64.mockImplementationOnce(() => new Promise((r) => (soltarFoto = r)));

      const aprovacao = svc.syncReservaArea(100);
      await new Promise((r) => setImmediate(r));
      ag.status = 'recusado';
      const recusa = svc.syncReservaArea(100);
      await new Promise((r) => setImmediate(r));
      // Sem o lock o remove (que não baixa foto) já teria saído aqui.
      expect(client.removePerson).not.toHaveBeenCalled();
      soltarFoto('BASE64');
      await Promise.all([aprovacao, recusa]);

      const ordem = [
        ...client.enrollPerson.mock.invocationCallOrder.map((n) => [n, 'enroll']),
        ...client.removePerson.mock.invocationCallOrder.map((n) => [n, 'remove']),
      ]
        .sort((a: any, b: any) => a[0] - b[0])
        .map((x) => x[1]);
      expect(ordem).toEqual(['enroll', 'remove']);
      expect(nomes).toEqual(['prestare:area:3:apto:50', 'prestare:area:3:apto:50']);
    });

    it('remoção que falha fica pendente; o tick refaz mesmo com a reserva já apagada, e depois limpa', async () => {
      jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
      const ag = reserva(100, '14:00', '18:00', { status: 'cancelado' });
      const { svc, prisma, client } = build({ reservas: [ag] });
      client.removePerson.mockRejectedValueOnce(new Error('agente offline'));

      const r = await svc.syncReservaArea(100);
      expect(r).toEqual(expect.objectContaining({ falhas: 1 }));

      // Síndico apagou a linha (removeAgendamento): não há reserva nenhuma a reler.
      prisma.areas_Sociais_Agendamentos.findUnique = jest.fn(async () => null);
      prisma.areas_Sociais_Agendamentos.findMany = jest.fn(async () => []);

      await (svc as any).tickReservasAreas();
      expect(client.removePerson).toHaveBeenCalledTimes(2);
      expect(client.removePerson).toHaveBeenLastCalledWith(DEVICE, 'morador_11', 'morador_11');

      // Saiu limpo: a marca some e o próximo tick não manda comando nenhum.
      await (svc as any).tickReservasAreas();
      expect(client.removePerson).toHaveBeenCalledTimes(2);
    });

    it('sync limpo não deixa marca (o tick não reenvia remoção que já chegou)', async () => {
      jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
      const ag = reserva(100, '14:00', '18:00', { status: 'recusado' });
      const { svc, prisma, client } = build({ reservas: [ag] });
      await svc.syncReservaArea(100);
      expect(client.removePerson).toHaveBeenCalledTimes(1);
      prisma.areas_Sociais_Agendamentos.findMany = jest.fn(async () => []);
      await (svc as any).tickReservasAreas();
      expect(client.removePerson).toHaveBeenCalledTimes(1);
    });
  });

  describe('F5 — morador excluído sem face_id sai dos terminais de área', () => {
    it('sem face_id: remove pela matrícula morador_<id> dos terminais de área do condomínio', async () => {
      const { svc, prisma, client } = build({ reservas: [] });
      const ok = await svc.unsyncMoradorExcluido(11, null, 1);
      expect(ok).toBe(true);
      expect(prisma.facial_Devices.findMany).toHaveBeenCalledWith({
        where: { id_condominio: 1, ativo: 1, tipo: 'facial', id_area_social: { not: null } },
      });
      expect(client.removePerson).toHaveBeenCalledWith(DEVICE, 'morador_11', 'morador_11');
    });

    it('com face_id: segue pelo unsyncMorador de sempre (todos os terminais)', async () => {
      const { svc } = build({ reservas: [] });
      const unsync = jest.spyOn(svc, 'unsyncMorador').mockResolvedValue(true);
      await svc.unsyncMoradorExcluido(11, 'f-11', 1);
      expect(unsync).toHaveBeenCalledWith(11, 'f-11', 1, { aposExclusao: true });
    });

    it('falha no terminal devolve false', async () => {
      const { svc, client } = build({ reservas: [] });
      client.removePerson.mockRejectedValueOnce(new Error('offline'));
      expect(await svc.unsyncMoradorExcluido(11, null, 1)).toBe(false);
    });
  });
});

describe('FacialService — F6: tag/QR no terminal da área exige reserva vigente', () => {
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

  const MORADORA = { id: 11, id_user: 111, nome: 'Ana', tipo: 'morador', id_condominio: 1, tag_rfid: 'ABC999' };
  const FUNCIONARIA = { ...MORADORA, id: 12, id_user: 112, nome: 'Bia', tipo: 'funcionario', tag_rfid: 'FUN111' };
  const LEITOR_AREA = {
    id: 42,
    id_condominio: 1,
    tipo: 'tag_reader',
    sentido: 'entrada',
    ativo: 1,
    confianca_minima: 0,
    id_area_social: 3,
    nome: 'Leitor da quadra',
    webhook_token: 'tok',
  };
  // 20/07/2026 10:00 UTC = 07:00 em Brasília.
  const TS = '2026-07-20T10:00:00.000Z';

  function build(opts: { reservas?: any[]; controle?: number; device?: any } = {}) {
    const acessos: any[] = [];
    const pessoas = [MORADORA, FUNCIONARIA];
    const filtra = ({ where }: any) =>
      pessoas.filter(
        (m) =>
          (where.id === undefined || where.id === m.id) &&
          (where.tag_rfid === undefined ||
            (typeof where.tag_rfid === 'string' ? where.tag_rfid === m.tag_rfid : where.tag_rfid.in.includes(m.tag_rfid))) &&
          where.face_id === undefined,
      );
    const prisma: any = {
      isConnected: true,
      facial_Devices: {
        findFirst: jest.fn(async () => opts.device ?? LEITOR_AREA),
        findMany: jest.fn(async () => []),
      },
      moradores: {
        findFirst: jest.fn(async (a: any) => filtra(a)[0] ?? null),
        findMany: jest.fn(async (a: any) => filtra(a)),
        findUnique: jest.fn(async ({ where }: any) => pessoas.find((p) => p.id === where.id) ?? null),
      },
      areas_Sociais: { findUnique: jest.fn(async () => ({ controle_acesso_facial: opts.controle ?? 1 })) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 50 }]) },
      areas_Sociais_Agendamentos: { findMany: jest.fn(async () => opts.reservas ?? []) },
      tags: { findMany: jest.fn(async () => []) },
      visitantes: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
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
    const accessState: any = {
      shouldDebounce: jest.fn(() => false),
      checkAntiPassback: jest.fn(() => 'allow'),
      hasPresenca: jest.fn(() => false),
      setPresenca: jest.fn(),
    };
    const svc = new FacialService(
      prisma,
      { triggerRelay: jest.fn(async () => ({ ok: true })) } as any,
      { sendPushNotification: jest.fn() } as any,
      { consumeForDevice: jest.fn(() => null) } as any,
      { registrar: jest.fn() } as any,
      accessState,
      {} as any,
    );
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    return { svc, prisma, acessos };
  }

  const eventos = (acessos: any[]) => acessos.map((a) => a.evento).filter((e) => e !== 'acionado_auto');

  it('morador SEM reserva: negado com "Sem reserva para esta área agora"', async () => {
    const { svc, acessos } = build({ reservas: [] });
    await expect(svc.processWebhook('tok', { card_uid: 'ABC999', timestamp: TS })).rejects.toThrow(
      /Sem reserva para esta área agora/,
    );
    expect(eventos(acessos)).toEqual(['negado']);
    expect(acessos[0].nome_pessoa).toContain('Sem reserva para esta área agora');
  });

  it('morador com reserva que ainda não começou (14h–18h, são 7h): negado', async () => {
    const { svc, acessos } = build({ reservas: [reserva(100, '14:00', '18:00')] });
    await expect(svc.processWebhook('tok', { card_uid: 'ABC999', timestamp: TS })).rejects.toThrow(
      /Sem reserva para esta área agora/,
    );
    expect(eventos(acessos)).toEqual(['negado']);
  });

  it('morador com reserva vigente (6h–9h, são 7h de Brasília): passa', async () => {
    const { svc, acessos } = build({ reservas: [reserva(100, '06:00', '09:00')] });
    const r = await svc.processWebhook('tok', { card_uid: 'ABC999', timestamp: TS });
    expect(r.evento).toBe('entrada');
    expect(eventos(acessos)).toEqual(['entrada']);
  });

  it('a hora é a de Brasília: reserva 9h–11h às 10h UTC (7h locais) é negada', async () => {
    const { svc } = build({ reservas: [reserva(100, '09:00', '11:00')] });
    await expect(svc.processWebhook('tok', { card_uid: 'ABC999', timestamp: TS })).rejects.toThrow(
      /Sem reserva para esta área agora/,
    );
  });

  it('funcionário passa sem reserva', async () => {
    const { svc, acessos } = build({ reservas: [] });
    const r = await svc.processWebhook('tok', { card_uid: 'FUN111', timestamp: TS });
    expect(r.evento).toBe('entrada');
    expect(eventos(acessos)).toEqual(['entrada']);
  });

  it('área sem reserva obrigatória: morador passa sem reserva', async () => {
    const { svc, acessos } = build({ reservas: [], controle: 0 });
    await svc.processWebhook('tok', { card_uid: 'ABC999', timestamp: TS });
    expect(eventos(acessos)).toEqual(['entrada']);
  });

  it('leitor fora de área social: nada muda', async () => {
    const { svc, prisma, acessos } = build({ reservas: [], device: { ...LEITOR_AREA, id_area_social: null } });
    await svc.processWebhook('tok', { card_uid: 'ABC999', timestamp: TS });
    expect(eventos(acessos)).toEqual(['entrada']);
    expect(prisma.areas_Sociais.findUnique).not.toHaveBeenCalled();
  });
});

describe('FacialService — teto de locks de área no processo (fix round 1)', () => {
  let Svc: any;
  let locksAreaEmUso: () => number;
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    delete process.env.FACIAL_LOCKS_AREA_MAX; // padrão 4
    jest.isolateModules(() => {
      const mod = require('./facial.service');
      Svc = mod.FacialService;
      locksAreaEmUso = mod.locksAreaEmUso;
    });
  });
  afterAll(() => jest.useRealTimers());

  /** 30 reservas de 30 aptos diferentes, canceladas (manutenção de duas semanas). */
  function build(opts: { enrollTrava?: Promise<void> } = {}) {
    const reservas = Array.from({ length: 30 }, (_, i) =>
      reserva(1000 + i, '14:00', '18:00', { id_apartamento: 500 + i, status: 'cancelado' }),
    );
    let abertas = 0;
    let picoAbertas = 0;
    const client = {
      enrollPerson: jest.fn(async () => ({ faceId: 'x' })),
      removePerson: jest.fn(async () => {
        if (opts.enrollTrava) await opts.enrollTrava;
        await new Promise((r) => setImmediate(r));
        return true;
      }),
    };
    const prisma: any = {
      isConnected: true,
      areas_Sociais: { findUnique: jest.fn(async () => ({ id: 3, id_condominio: 1, controle_acesso_facial: 1 })) },
      areas_Sociais_Agendamentos: {
        findUnique: jest.fn(async ({ where }: any) => reservas.find((r) => r.id === where.id) ?? null),
        findMany: jest.fn(async () => []),
      },
      facial_Devices: { findMany: jest.fn(async () => [DEVICE]) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_user: 111 }]) },
      moradores: { findMany: jest.fn(async () => [ANA]) },
      // Cada transação é uma conexão do pool segurando o GET_LOCK.
      $transaction: jest.fn(async (fn: any) => {
        abertas++;
        picoAbertas = Math.max(picoAbertas, abertas);
        try {
          return await fn({ $queryRaw: async () => [{ ok: 1 }] });
        } finally {
          abertas--;
        }
      }),
    };
    const consentimentos = { autorizouBiometria: jest.fn(async () => true) };
    const svc = new Svc(prisma, client as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, consentimentos as any, {} as any);
    jest.spyOn(svc as any, 'toConfig').mockImplementation((d: any) => d);
    return { svc, prisma, client, reservas, pico: () => picoAbertas, abertas: () => abertas };
  }

  it('30 syncs disparados juntos: no máximo 4 transações de lock abertas e todos terminam', async () => {
    const { svc, client, reservas, pico, abertas } = build();
    const resultados = await Promise.all(reservas.map((r) => svc.syncReservaArea(r.id)));
    expect(pico()).toBeLessThanOrEqual(4);
    expect(pico()).toBeGreaterThan(1); // o teto não serializa tudo
    expect(abertas()).toBe(0);
    expect(locksAreaEmUso()).toBe(0);
    expect(resultados.every((x: any) => x.ok === true && x.falhas === 0)).toBe(true);
    expect(client.removePerson).toHaveBeenCalledTimes(30);
  });

  it('sem vaga dentro do prazo: não abre transação e grava a marca de pendente para o tick', async () => {
    let soltar!: () => void;
    const trava = new Promise<void>((r) => (soltar = r));
    const { svc, prisma, reservas } = build({ enrollTrava: trava });
    // 4 syncs presos no terminal ocupam o teto.
    const presos = reservas.slice(0, 4).map((r) => svc.syncReservaArea(r.id));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(locksAreaEmUso()).toBe(4);

    const quinto = svc.syncReservaArea(reservas[4].id);
    await jest.advanceTimersByTimeAsync(61_000);
    await expect(quinto).resolves.toEqual({ skipped: true, reason: 'lock_ocupado' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
    const marcas = await (svc as any).estado.listarPorPrefixo('facial:area-pendente:');
    expect(marcas.map((m: any) => m.chave)).toEqual(['facial:area-pendente:3:504']);

    soltar();
    await Promise.all(presos);
    expect(locksAreaEmUso()).toBe(0);
  });
});
