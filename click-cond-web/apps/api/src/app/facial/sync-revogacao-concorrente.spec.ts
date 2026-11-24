/**
 * Q1 — revogação não perde a corrida para um sync em voo da mesma pessoa.
 *
 * O sync lê a autorização, faz E/S lenta (foto do storage, terminal mudo segura 25 s por enqueue) e só
 * então manda o `update` — que no Dahua remove e recria a pessoa. Se a revogação (biometria revogada,
 * bloqueio) entrava no meio, o terminal recebia remove e DEPOIS update: o rosto voltava, e a gravação
 * final do sync punha "synced" por cima de "revoked" (apagando a marca REVOGADO_PELO_OPERADOR).
 *
 * Aqui a foto chega atrasada e a revogação entra no meio. O lock por pessoa é simulado em memória
 * (GET_LOCK/RELEASE_LOCK do fake `$transaction`); um cenário roda SEM lock (Prisma falso sem
 * `$transaction`) para provar que a releitura da autorização antes do enqueue fecha a corrida sozinha.
 */
import { ConsentimentosService, POLITICA_VERSAO, REVOGADO_PELO_OPERADOR } from '../consentimentos/consentimentos.service';

let FacialService: any;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET_LOCK/RELEASE_LOCK do MySQL em memória: sem espera (timeout 0), como o facial pede. */
function travaEmMemoria() {
  const donos = new Set<string>();
  return {
    donos,
    $transaction: async (fn: any) =>
      fn({
        $queryRaw: async (strings: TemplateStringsArray, ...vals: any[]) => {
          const chave = String(vals[0]);
          if (strings.join('?').includes('GET_LOCK')) {
            if (donos.has(chave)) return [{ ok: 0 }];
            donos.add(chave);
            return [{ ok: 1 }];
          }
          donos.delete(chave);
          return [{ ok: 1 }];
        },
      }),
  };
}

describe('Q1 — sync em voo × revogação da mesma pessoa', () => {
  beforeAll(() => {
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    delete process.env.PESSOAS_MIGRATION_ENABLED;
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });

  const ADULTO = new Date('1990-01-01');
  const DEVICES = [
    { id: 101, id_condominio: 1, ativo: 1, tipo: 'facial', fabricante: 'dahua', sentido: 'auto' },
    { id: 102, id_condominio: 1, ativo: 1, tipo: 'facial', fabricante: 'dahua', sentido: 'auto' },
  ];

  type Comando = { tipo: 'enroll' | 'update' | 'remove'; device: number };

  function cliente(comandos: Comando[]) {
    return {
      enrollPerson: jest.fn(async (cfg: any, p: any) => {
        await dormir(20);
        comandos.push({ tipo: 'enroll', device: cfg.id });
        return { faceId: p.externalId };
      }),
      updatePerson: jest.fn(async (cfg: any) => {
        await dormir(20);
        comandos.push({ tipo: 'update', device: cfg.id });
      }),
      removePerson: jest.fn(async (cfg: any) => {
        await dormir(10);
        comandos.push({ tipo: 'remove', device: cfg.id });
      }),
    };
  }

  /** Último comando que cada terminal recebeu. */
  const ultimoPorTerminal = (comandos: Comando[]) => {
    const m = new Map<number, string>();
    for (const c of comandos) m.set(c.device, c.tipo);
    return Object.fromEntries(m);
  };

  function novoFacial(prisma: any, client: any, consentimentos: any, consentimentosTerceiros: any = null) {
    const facial = new FacialService(
      prisma,
      client,
      null as any,
      null as any,
      { registrar: jest.fn() } as any,
      null as any,
      { isOnline: jest.fn(() => true) } as any,
      null as any,
      consentimentos,
      consentimentosTerceiros,
    );
    jest.spyOn(facial as any, 'gatedAreaDeviceIds').mockResolvedValue(new Set());
    jest.spyOn(facial as any, 'categoriasPermitidasNoDispositivo').mockResolvedValue(null);
    jest.spyOn(facial as any, 'toConfig').mockImplementation((d: any) => d);
    return facial;
  }

  // ---------------------------------------------------------------- morador

  function cenarioMorador(opts: { comLock: boolean; atrasoFotoMs?: number }) {
    const linha: any = {
      id: 1,
      id_user: 7,
      id_condominio: 1,
      nome: 'Morador Teste',
      tipo: 'proprietario',
      data_nascimento: ADULTO,
      extra2: null,
      foto_pessoa: 'https://pub.example.com/moradores/foto.jpg',
      face_id: 'morador_1',
      face_sync_status: 'synced',
      face_sync_error: null,
      face_enrolled_at: new Date('2026-01-01'),
    };
    let t = Date.now() - 60_000;
    const registros: any[] = [
      { id_user: 7, tipo: 'biometria', versao: POLITICA_VERSAO, aceito: 1, registrado_em: new Date(t++) },
    ];
    const trava = travaEmMemoria();
    const prisma: any = {
      isConnected: true,
      ...(opts.comLock ? { $transaction: trava.$transaction } : {}),
      consentimentos: {
        findFirst: jest.fn(async ({ where }: any) =>
          registros
            .filter((r) => r.id_user === where.id_user && r.tipo === where.tipo)
            .sort((a, b) => b.registrado_em - a.registrado_em)[0] ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          registros.push({ ...data, registrado_em: new Date(t++) });
          return data;
        }),
      },
      moradores: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === linha.id ? { ...linha } : null)),
        findMany: jest.fn(async ({ where }: any) =>
          where.id_user === linha.id_user && (where.id_condominio == null || where.id_condominio === linha.id_condominio)
            ? [{ ...linha }]
            : [],
        ),
        count: jest.fn(async () => 0),
        update: jest.fn(async ({ where, data }: any) => {
          if (where.id !== linha.id) throw new Error('linha inexistente');
          return Object.assign(linha, data);
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      users: { updateMany: jest.fn(async () => ({ count: 0 })), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
      facial_Devices: {
        findMany: jest.fn(async () => DEVICES.map((d) => ({ ...d }))),
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
    };
    const comandos: Comando[] = [];
    const client = cliente(comandos);
    const ponte: any = {};
    const consentimentos = new ConsentimentosService(prisma, ponte, { deleteUrl: jest.fn(async () => true) } as any);
    const facial = novoFacial(prisma, client, consentimentos);
    ponte.unsyncMorador = (...a: any[]) => (facial as any).unsyncMorador(...a);
    // Foto atrasada: o sync fica "em voo" com a autorização lida antes da revogação.
    jest.spyOn(facial as any, 'fetchPhotoAsBase64').mockImplementation(async () => {
      await dormir(opts.atrasoFotoMs ?? 150);
      return 'Zm90bw==';
    });
    return { facial, consentimentos, prisma, client, comandos, linha, trava };
  }

  it('revogação pelo operador durante o sync (com lock): estado final revoked com a marca e o último comando de cada terminal é remove', async () => {
    const { facial, consentimentos, comandos, linha, trava } = cenarioMorador({ comLock: true });

    const sync = facial.syncMorador(1);
    await dormir(30); // o sync já leu a autorização e está esperando a foto
    await consentimentos.revogarBiometria(7, 'Portaria', 1);
    await sync;

    expect(ultimoPorTerminal(comandos)).toEqual({ 101: 'remove', 102: 'remove' });
    // Depois que a revogação começou, nenhum update/enroll saiu.
    expect(comandos.some((c) => c.tipo !== 'remove')).toBe(false);
    expect(linha.face_id).toBeNull();
    expect(linha.face_sync_status).toBe('revoked');
    expect(linha.face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
    expect(trava.donos.size).toBe(0);
  });

  it('revogação pelo próprio titular durante o sync, SEM lock: a releitura antes do enqueue não deixa o rosto voltar', async () => {
    const { facial, consentimentos, comandos, linha } = cenarioMorador({ comLock: false });

    const sync = facial.syncMorador(1);
    await dormir(30);
    await consentimentos.revogarBiometria(7);
    const r = await sync;

    expect(ultimoPorTerminal(comandos)).toEqual({ 101: 'remove', 102: 'remove' });
    expect(comandos.some((c) => c.tipo !== 'remove')).toBe(false);
    expect(linha.face_id).toBeNull();
    expect(linha.face_sync_status).toBe('revoked');
    expect(r).not.toMatchObject({ status: 'synced' });
  });

  it('revogação no meio de vários terminais: o que já recebeu update antes recebe remove depois', async () => {
    const { facial, consentimentos, client, comandos, linha } = cenarioMorador({ comLock: true, atrasoFotoMs: 5 });
    // O 1º update demora: a revogação entra enquanto o terminal 101 está sendo atualizado.
    client.updatePerson.mockImplementationOnce(async (cfg: any) => {
      await dormir(120);
      comandos.push({ tipo: 'update', device: cfg.id });
    });

    const sync = facial.syncMorador(1);
    await dormir(40);
    await consentimentos.revogarBiometria(7, 'Portaria', 1);
    await sync;

    expect(comandos[0]).toEqual({ tipo: 'update', device: 101 });
    // O 102 nunca recebe update: a autorização é relida antes de enfileirar.
    expect(comandos.filter((c) => c.tipo === 'update').map((c) => c.device)).toEqual([101]);
    expect(ultimoPorTerminal(comandos)).toEqual({ 101: 'remove', 102: 'remove' });
    expect(linha.face_sync_status).toBe('revoked');
    expect(linha.face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
  });

  it('lock ocupado além da espera: a revogação não é descartada — fica pending_removal e o sync em voo remove ao reler', async () => {
    const { facial, consentimentos, comandos, linha, prisma } = cenarioMorador({ comLock: true, atrasoFotoMs: 300 });
    (facial as any).esperaLockPessoaMs = 60;

    const sync = facial.syncMorador(1);
    await dormir(30);
    const rev = await consentimentos.revogarBiometria(7, 'Portaria', 1);
    // A remoção não pegou o lock a tempo: a revogação devolve pendente (não "removido").
    expect(rev).toMatchObject({ status: 'pending_removal' });
    // A marca foi gravada ANTES da tentativa de remoção.
    const primeiraGravacao = prisma.moradores.update.mock.calls[0][0];
    expect(primeiraGravacao.data).toMatchObject({ face_sync_error: REVOGADO_PELO_OPERADOR });
    await sync;

    expect(ultimoPorTerminal(comandos)).toEqual({ 101: 'remove', 102: 'remove' });
    expect(linha.face_id).toBeNull();
    expect(linha.face_sync_status).toBe('revoked');
    expect(linha.face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
  });

  it('segundo sync da mesma pessoa com o lock ocupado além da espera: marca pending para o tickSyncRetry', async () => {
    const { facial, linha, prisma } = cenarioMorador({ comLock: true, atrasoFotoMs: 300 });
    (facial as any).esperaLockPessoaMs = 60;

    const primeiro = facial.syncMorador(1);
    await dormir(30);
    const segundo = await facial.syncMorador(1);
    expect(segundo).toMatchObject({ ok: false, status: 'pending' });
    expect(prisma.moradores.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { face_sync_status: 'pending' } });
    await primeiro;
    expect(linha.face_sync_status).toBe('synced');
  });

  // ---------------------------------------------------------------- pessoa

  it('pessoa bloqueada durante o sync (com lock): o 2º sync espera, o 1º não manda update e o último comando é remove', async () => {
    const agora = Date.now();
    const pessoa: any = {
      id: 20,
      id_condominio: 1,
      nome: 'Visitante',
      tipo_pessoa: 'visitante',
      doc_identificacao: '123',
      foto_pessoa: 'https://pub.example.com/pessoas/foto.jpg',
      face_id: 'pessoa_20',
      face_sync_status: 'synced',
      face_sync_error: null,
      face_enrolled_at: null,
      bloqueado: 0,
      visitas: [
        {
          id: 55,
          id_pessoa: 20,
          id_condominio: 1,
          liberado: 1,
          bloqueado: 0,
          is_prestador: 0,
          data_hora_inicio: new Date(agora - 60_000),
          data_hora_termino: new Date(agora + 3_600_000),
        },
      ],
    };
    const trava = travaEmMemoria();
    const prisma: any = {
      isConnected: true,
      $transaction: trava.$transaction,
      pessoas: {
        findUnique: jest.fn(async () => ({ ...pessoa, visitas: pessoa.visitas.map((v: any) => ({ ...v })) })),
        update: jest.fn(async ({ data }: any) => Object.assign(pessoa, data)),
      },
      vagas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => DEVICES.map((d) => ({ ...d }))) },
    };
    const comandos: Comando[] = [];
    const client = cliente(comandos);
    const terceiros = { autorizouBiometria: jest.fn(async () => true) };
    const facial = novoFacial(prisma, client, null, terceiros);
    jest.spyOn(facial as any, 'fetchPhotoAsBase64').mockImplementation(async () => {
      await dormir(150);
      return 'Zm90bw==';
    });

    const sync = facial.syncPessoa(20);
    await dormir(30);
    pessoa.bloqueado = 1; // portaria bloqueia
    const revogacao = facial.syncPessoa(20); // o bloqueio dispara o sync de revogação
    await Promise.all([sync, revogacao]);

    expect(comandos.some((c) => c.tipo !== 'remove')).toBe(false);
    expect(ultimoPorTerminal(comandos)).toEqual({ 101: 'remove', 102: 'remove' });
    expect(pessoa.face_sync_status).toBe('revoked');
    expect(trava.donos.size).toBe(0);
  });
});
