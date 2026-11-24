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
import { nomeDoLockMysql } from '../common/lock-distribuido';

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
    ponte.comLockDoMorador = (...a: any[]) => (facial as any).comLockDoMorador(...a);
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

  it('1º enroll em voo (face_id ainda nulo) e revogação entre a última releitura e a gravação final: o rosto sai', async () => {
    const { facial, consentimentos, prisma, comandos, linha } = cenarioMorador({ comLock: true, atrasoFotoMs: 5 });
    linha.face_id = null;
    linha.face_sync_status = 'pending';
    // A revogação entra exatamente quando o sync, já tendo relido, vai gravar "synced" com o face_id.
    // (A revogação é disparada pelo corpo do teste, fora do fluxo assíncrono do sync.)
    const gravar = prisma.moradores.update.getMockImplementation();
    let chegou!: () => void;
    const naGravacaoFinal = new Promise<void>((r) => (chegou = r));
    let segurou = false;
    prisma.moradores.update.mockImplementation(async (args: any) => {
      if (args.data?.face_sync_status === 'synced' && !segurou) {
        segurou = true;
        chegou();
        await dormir(50);
      }
      return gravar(args);
    });

    const sync = facial.syncMorador(1);
    await naGravacaoFinal;
    const revogacao = consentimentos.revogarBiometria(7, 'Portaria', 1);
    await sync;
    await revogacao;

    // Enroll no 1º terminal (gera o face_id) e update no 2º, todos antes da revogação.
    expect(comandos.slice(0, 2)).toEqual([
      { tipo: 'enroll', device: 101 },
      { tipo: 'update', device: 102 },
    ]);
    expect(ultimoPorTerminal(comandos)).toEqual({ 101: 'remove', 102: 'remove' });
    expect(linha.face_id).toBeNull();
    expect(linha.face_sync_status).toBe('revoked');
    expect(linha.face_sync_error).toBe(REVOGADO_PELO_OPERADOR);
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

  // ---------------------------------------------------------------- teto de locks (pool)

  function cenarioMuitasPessoas(qtd: number, atrasoFotoMs: number) {
    const agora = Date.now();
    const pessoas = new Map<number, any>();
    for (let i = 1; i <= qtd; i++) {
      pessoas.set(i, {
        id: i,
        id_condominio: 1,
        nome: `Visitante ${i}`,
        tipo_pessoa: 'visitante',
        doc_identificacao: String(i),
        foto_pessoa: 'https://pub.example.com/pessoas/foto.jpg',
        face_id: null,
        face_sync_status: 'pending',
        face_sync_error: null,
        face_enrolled_at: null,
        bloqueado: 0,
        visitas: [
          {
            id: 1000 + i,
            id_pessoa: i,
            id_condominio: 1,
            liberado: 1,
            bloqueado: 0,
            is_prestador: 0,
            data_hora_inicio: new Date(agora - 60_000),
            data_hora_termino: new Date(agora + 3_600_000),
          },
        ],
      });
    }
    const trava = travaEmMemoria();
    // Conexões presas pelos locks: cada transação interativa segura uma do começo ao fim.
    const conexoes = { emUso: 0, max: 0 };
    const prisma: any = {
      isConnected: true,
      $transaction: async (fn: any) => {
        conexoes.emUso++;
        conexoes.max = Math.max(conexoes.max, conexoes.emUso);
        try {
          return await trava.$transaction(fn);
        } finally {
          conexoes.emUso--;
        }
      },
      pessoas: {
        findUnique: jest.fn(async ({ where }: any) => {
          const p = pessoas.get(where.id);
          return p ? { ...p, visitas: p.visitas.map((v: any) => ({ ...v })) } : null;
        }),
        update: jest.fn(async ({ where, data }: any) => Object.assign(pessoas.get(where.id), data)),
      },
      vagas: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      facial_Devices: { findMany: jest.fn(async () => [{ ...DEVICES[0] }]) },
    };
    const comandos: Comando[] = [];
    const facial = novoFacial(prisma, cliente(comandos), null, { autorizouBiometria: jest.fn(async () => true) });
    jest.spyOn(facial as any, 'fetchPhotoAsBase64').mockImplementation(async () => {
      await dormir(atrasoFotoMs);
      return 'Zm90bw==';
    });
    return { facial, pessoas, conexoes, comandos };
  }

  it('30 syncs em paralelo (tick): nunca mais que 6 locks/conexões ao mesmo tempo e todos terminam synced', async () => {
    const { facial, pessoas, conexoes } = cenarioMuitasPessoas(30, 40);

    const rs = await Promise.all([...pessoas.keys()].map((id) => facial.syncPessoa(id)));

    expect(conexoes.max).toBeLessThanOrEqual(6);
    expect(conexoes.max).toBeGreaterThan(1);
    expect(conexoes.emUso).toBe(0);
    expect(rs.every((r: any) => r.status === 'synced')).toBe(true);
    expect([...pessoas.values()].every((p) => p.face_sync_status === 'synced')).toBe(true);
  });

  it('30 syncs em paralelo com espera curta: o teto segura, ninguém fica preso e quem não achou vaga fica pending', async () => {
    const { facial, pessoas, conexoes } = cenarioMuitasPessoas(30, 150);
    (facial as any).esperaLockPessoaMs = 100;

    const rs = await Promise.all([...pessoas.keys()].map((id) => facial.syncPessoa(id)));

    expect(conexoes.max).toBeLessThanOrEqual(6);
    expect(conexoes.emUso).toBe(0);
    expect(rs.every((r: any) => r.status === 'synced' || r.status === 'pending')).toBe(true);
    expect(rs.some((r: any) => r.status === 'pending')).toBe(true);
    for (const p of pessoas.values()) expect(['synced', 'pending']).toContain(p.face_sync_status);
  });

  it('ticks ocupando o teto deles: o sync interativo ainda acha vaga (2 vagas reservadas)', async () => {
    const { facial, conexoes } = cenarioMuitasPessoas(13, 300);
    (facial as any).esperaLockPessoaMs = 100;
    // 12 syncs de tick em 4 condomínios (3 por condomínio = 12 em paralelo sem o teto global).
    const doTick = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, id_condominio: (i % 4) + 1 }));
    const tick = (facial as any).sincronizarPessoasDoTick('teste', doTick, 'sincronizado(s)');
    await dormir(30);

    // Cadastro na portaria no meio do tick: não pode esperar o tick inteiro nem virar 'pending'.
    const interativo = await facial.syncPessoa(13);
    expect(interativo.status).toBe('synced');

    await tick;
    expect(conexoes.max).toBeLessThanOrEqual(6);
    expect(conexoes.emUso).toBe(0);
  });

  // ---------------------------------------------------------------- remoção após exclusão

  function cenarioRemocao() {
    const trava = travaEmMemoria();
    const prisma: any = {
      isConnected: true,
      $transaction: trava.$transaction,
      facial_Devices: { findMany: jest.fn(async () => DEVICES.map((d) => ({ ...d }))) },
    };
    const comandos: Comando[] = [];
    const facial = novoFacial(prisma, cliente(comandos), null);
    (facial as any).esperaLockPessoaMs = 60;
    return { facial, trava, comandos };
  }

  it('controle: remoção comum com o lock da pessoa ocupado devolve false e não sai para os terminais', async () => {
    const { facial, trava, comandos } = cenarioRemocao();
    trava.donos.add(nomeDoLockMysql('facial:pessoa:morador:5')); // sync da mesma pessoa em voo, segurando o lock
    expect(await facial.unsyncMorador(5, 'f5', 1)).toBe(false);
    expect(comandos).toEqual([]);
  });

  it.each([
    ['morador excluído', 'morador', (f: any) => f.unsyncMoradorExcluido(5, 'f5', 1)],
    ['visitante excluído', 'visitante', (f: any) => f.unsyncVisitante(5, 'f5', 1, { aposExclusao: true })],
    ['pessoa excluída', 'pessoa', (f: any) => f.unsyncPessoa(5, 'f5', 1, { aposExclusao: true })],
    ['prestador excluído', 'prestador_servico', (f: any) => f.unsyncPrestadorServico(5, 'f5', 1, { aposExclusao: true })],
  ])('%s: com o lock da pessoa ocupado a remoção sai mesmo assim para todos os terminais', async (_n, tipo, remover) => {
    const { facial, trava, comandos } = cenarioRemocao();
    trava.donos.add(nomeDoLockMysql(`facial:pessoa:${tipo}:5`));
    expect(await remover(facial)).toBe(true);
    expect(ultimoPorTerminal(comandos)).toEqual({ 101: 'remove', 102: 'remove' });
    expect(trava.donos.size).toBe(1); // nem tentou pegar o lock
  });

  it('morador excluído com o teto de locks tomado por outros syncs: a remoção não espera vaga', async () => {
    const { facial, comandos } = cenarioMuitasPessoas(6, 400);
    (facial as any).esperaLockPessoaMs = 60;
    // 6 syncs interativos seguram as 6 vagas do teto (cada um ~400 ms).
    const ocupando = Promise.all([1, 2, 3, 4, 5, 6].map((id) => facial.syncPessoa(id)));
    await dormir(30);
    const inicio = Date.now();
    expect(await facial.unsyncMoradorExcluido(99, 'f99', 1)).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(300);
    expect(comandos.some((c) => c.tipo === 'remove')).toBe(true);
    await ocupando;
  });
});
