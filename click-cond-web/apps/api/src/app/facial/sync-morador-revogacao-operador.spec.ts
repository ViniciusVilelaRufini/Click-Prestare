/**
 * R5b — revogação de biometria feita pelo OPERADOR (síndico/portaria) num condomínio.
 *
 * Depois da Tarefa 5 essa revogação não grava mais a recusa global (o consentimento da pessoa segue
 * `aceito = 1`): bastava gravar uma `foto_pessoa` nova na linha `Moradores` daquele condomínio para o
 * `syncMorador` matricular o rosto de novo. Agora a linha fica marcada e o rosto só volta a ser
 * matriculado ali depois de um novo aceite de biometria do próprio titular. Os outros condomínios da
 * pessoa e a revogação feita pelo titular (global) não mudam.
 *
 * Mocks em memória (ConsentimentosService e FacialService reais), sem banco e sem aparelho.
 */
import { ConsentimentosService, POLITICA_VERSAO } from '../consentimentos/consentimentos.service';

let FacialService: any;

describe('R5b — revogação pelo operador bloqueia o recadastro do rosto no condomínio', () => {
  beforeAll(() => {
    process.env.FACIAL_INTEGRATION_ENABLED = 'true';
    delete process.env.PESSOAS_MIGRATION_ENABLED;
    jest.isolateModules(() => {
      FacialService = require('./facial.service').FacialService;
    });
  });

  const TERMO = 'CONSENTIMENTO_BIOMETRIA_ACEITO_EM:2026-09-23T15:00:00.000';
  const ADULTO = new Date('1990-01-01');
  const MENOR = new Date(Date.now() - 10 * 365 * 86400_000);
  const TITULAR = { sub: 7, nome: 'Morador Teste', typeAccess: 'Morador' } as any;

  type Linha = {
    id: number;
    id_user: number;
    id_condominio: number;
    nome: string;
    tipo: string;
    data_nascimento: Date | null;
    extra2: string | null;
    foto_pessoa: string | null;
    face_id: string | null;
    face_sync_status: string | null;
    face_sync_error: string | null;
    face_enrolled_at: Date | null;
  };
  const linha = (over: Partial<Linha>): Linha => ({
    id: 1,
    id_user: 7,
    id_condominio: 1,
    nome: 'Morador Teste',
    tipo: 'proprietario',
    data_nascimento: ADULTO,
    extra2: null,
    foto_pessoa: 'https://pub.example.com/moradores/antiga.jpg',
    face_id: 'morador_1',
    face_sync_status: 'synced',
    face_sync_error: null,
    face_enrolled_at: new Date('2026-01-01'),
    ...over,
  });

  function build(linhas: Linha[], aceites: Array<{ id_user: number; aceito: number }> = [{ id_user: 7, aceito: 1 }]) {
    let t = Date.now() - 60_000;
    const registros: any[] = aceites.map((a) => ({
      ...a,
      tipo: 'biometria',
      versao: POLITICA_VERSAO,
      registrado_em: new Date(t++),
    }));
    const casa = (where: any, m: Linha) =>
      Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
        if (v && typeof v === 'object' && 'not' in v) return (m as any)[k] !== v.not;
        return (m as any)[k] === v;
      });
    const prisma: any = {
      isConnected: true,
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
        createMany: jest.fn(async ({ data }: any) => {
          for (const d of data) registros.push({ ...d, registrado_em: new Date(t++) });
          return { count: data.length };
        }),
      },
      moradores: {
        findUnique: jest.fn(async ({ where }: any) => linhas.find((m) => m.id === where.id) ?? null),
        findMany: jest.fn(async ({ where }: any) => linhas.filter((m) => casa(where, m))),
        count: jest.fn(async ({ where }: any) => linhas.filter((m) => casa(where, m)).length),
        update: jest.fn(async ({ where, data }: any) => Object.assign(linhas.find((m) => m.id === where.id)!, data)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const alvo = linhas.filter((m) => casa(where, m));
          for (const m of alvo) Object.assign(m, data);
          return { count: alvo.length };
        }),
      },
      users: { updateMany: jest.fn(async () => ({ count: 0 })), count: jest.fn(async () => 0) },
      sindicos_Condominios: { count: jest.fn(async () => 0) },
      funcionarios: { count: jest.fn(async () => 0) },
      apartamentos_Users: { count: jest.fn(async () => 0) },
      facial_Devices: {
        findMany: jest.fn(async ({ where }: any) => [
          { id: 100 + where.id_condominio, id_condominio: where.id_condominio, ativo: 1, tipo: 'facial', fabricante: 'intelbras' },
        ]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const client: any = {
      enrollPerson: jest.fn(async (_cfg: any, p: any) => ({ faceId: p.externalId })),
      updatePerson: jest.fn(async () => undefined),
      removePerson: jest.fn(async () => undefined),
    };
    const ponte: any = {};
    const consentimentos = new ConsentimentosService(prisma, ponte, { deleteUrl: jest.fn(async () => true) } as any);
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
      null as any,
    );
    jest.spyOn(facial as any, 'fetchPhotoAsBase64').mockResolvedValue('Zm90bw==');
    jest.spyOn(facial as any, 'gatedAreaDeviceIds').mockResolvedValue(new Set());
    jest.spyOn(facial as any, 'categoriasPermitidasNoDispositivo').mockResolvedValue(null);
    jest.spyOn(facial as any, 'toConfig').mockImplementation((d: any) => d);
    const unsync = jest.spyOn(facial as any, 'unsyncMorador').mockResolvedValue(true);
    ponte.unsyncMorador = (...a: any[]) => (facial as any).unsyncMorador(...a);
    return { consentimentos, facial, prisma, client, linhas, unsync };
  }

  const NOVA = 'https://pub.example.com/moradores/nova.jpg';
  const enrolouNoCondominio = (client: any, idCondominio: number) =>
    client.enrollPerson.mock.calls.some(([cfg]: any[]) => cfg.id_condominio === idCondominio);

  it('(a) depois da revogação pelo operador no condomínio 1, foto nova na linha de lá NÃO matricula', async () => {
    const { consentimentos, facial, client, linhas } = build([linha({ id: 1, id_condominio: 1 })]);
    await consentimentos.revogarBiometria(7, 'Portaria', 1);

    linhas[0].foto_pessoa = NOVA; // operador (ou edição de morador) grava foto nova
    const r = await facial.syncMorador(1);

    expect(client.enrollPerson).not.toHaveBeenCalled();
    expect(client.updatePerson).not.toHaveBeenCalled();
    expect(r).toMatchObject({ skipped: true });
    expect(linhas[0].face_id).toBeNull();
  });

  it('(a) cadastro sem rosto e sem foto no condomínio 1 também fica bloqueado', async () => {
    const { consentimentos, facial, client, linhas } = build([
      linha({ id: 1, id_condominio: 1, face_id: null, foto_pessoa: null, face_sync_status: null }),
    ]);
    await consentimentos.revogarBiometria(7, 'Portaria', 1);

    linhas[0].foto_pessoa = NOVA;
    await facial.syncMorador(1);

    expect(client.enrollPerson).not.toHaveBeenCalled();
  });

  it('(a) aparelho offline na revogação (pending_removal): a foto nova não matricula e o rosto antigo sai', async () => {
    const { consentimentos, facial, client, linhas, unsync } = build([linha({ id: 1, id_condominio: 1 })]);
    unsync.mockResolvedValueOnce(false);
    await consentimentos.revogarBiometria(7, 'Portaria', 1);
    expect(linhas[0].face_sync_status).toBe('pending_removal');

    linhas[0].foto_pessoa = NOVA;
    await facial.syncMorador(1);

    expect(client.enrollPerson).not.toHaveBeenCalled();
    expect(client.updatePerson).not.toHaveBeenCalled();
    expect(unsync).toHaveBeenLastCalledWith(1, 'morador_1', 1);
    expect(linhas[0].face_id).toBeNull();
    // Continua bloqueado depois de concluir a remoção.
    await facial.syncMorador(1);
    expect(client.enrollPerson).not.toHaveBeenCalled();
  });

  it('(b) a linha da mesma pessoa no condomínio 2 continua matriculando', async () => {
    const { consentimentos, facial, client, linhas } = build([
      linha({ id: 1, id_condominio: 1 }),
      linha({ id: 2, id_condominio: 2, face_id: null, face_sync_status: null }),
    ]);
    await consentimentos.revogarBiometria(7, 'Portaria', 1);

    linhas[1].foto_pessoa = NOVA;
    const r = await facial.syncMorador(2);

    expect(r).toMatchObject({ ok: true });
    expect(enrolouNoCondominio(client, 2)).toBe(true);
    expect(linhas[1].face_sync_status).toBe('synced');
  });

  it('(c) depois de novo aceite de biometria do titular, a linha do condomínio 1 volta a matricular', async () => {
    const { consentimentos, facial, client, linhas } = build([linha({ id: 1, id_condominio: 1 })]);
    await consentimentos.revogarBiometria(7, 'Portaria', 1);
    linhas[0].foto_pessoa = NOVA;
    await facial.syncMorador(1);
    expect(client.enrollPerson).not.toHaveBeenCalled();

    await consentimentos.registrar(TITULAR, { privacidade: true, biometria: true });
    const r = await facial.syncMorador(1);

    expect(r).toMatchObject({ ok: true });
    expect(enrolouNoCondominio(client, 1)).toBe(true);
    expect(linhas[0].face_sync_status).toBe('synced');
  });

  it('(c) aceite que recusa a biometria não desbloqueia', async () => {
    const { consentimentos, facial, client, linhas } = build([linha({ id: 1, id_condominio: 1 })]);
    await consentimentos.revogarBiometria(7, 'Portaria', 1);

    await consentimentos.registrar(TITULAR, { privacidade: true, biometria: false });
    await consentimentos.registrar(TITULAR, { privacidade: true, biometria: false });
    linhas[0].foto_pessoa = NOVA;
    await facial.syncMorador(1);

    expect(client.enrollPerson).not.toHaveBeenCalled();
  });

  it('(d) menor com termo do responsável continua matriculando, inclusive vindo do bloqueio de menor', async () => {
    const { facial, client, linhas } = build([
      linha({ id: 3, id_user: 8, data_nascimento: MENOR, extra2: TERMO, face_id: null, face_sync_status: 'revoked', face_sync_error: 'menor_de_idade' }),
    ], [{ id_user: 8, aceito: 1 }]);
    linhas[0].foto_pessoa = NOVA;

    const r = await facial.syncMorador(3);

    expect(r).toMatchObject({ ok: true });
    expect(client.enrollPerson).toHaveBeenCalled();
  });

  it('(d) menor sem termo do responsável continua bloqueado', async () => {
    const { facial, client, linhas } = build([
      linha({ id: 3, id_user: 8, data_nascimento: MENOR, extra2: null, face_id: null, face_sync_status: null }),
    ], [{ id_user: 8, aceito: 1 }]);
    linhas[0].foto_pessoa = NOVA;

    const r = await facial.syncMorador(3);

    expect(r).toMatchObject({ skipped: true, reason: 'menor_de_idade_ou_sem_comprovacao' });
    expect(client.enrollPerson).not.toHaveBeenCalled();
  });

  it('(e) revogação pelo titular continua global: grava a recusa e bloqueia todos os condomínios', async () => {
    const { consentimentos, facial, client, linhas, prisma } = build([
      linha({ id: 1, id_condominio: 1 }),
      linha({ id: 2, id_condominio: 2, face_id: 'morador_2' }),
    ]);
    await consentimentos.revogarBiometria(TITULAR);

    expect(prisma.consentimentos.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_user: 7, tipo: 'biometria', aceito: 0 }),
    });
    linhas[0].foto_pessoa = NOVA;
    linhas[1].foto_pessoa = NOVA;
    await facial.syncMorador(1);
    await facial.syncMorador(2);
    expect(client.enrollPerson).not.toHaveBeenCalled();

    await consentimentos.registrar(TITULAR, { privacidade: true, biometria: true });
    await facial.syncMorador(1);
    await facial.syncMorador(2);
    expect(enrolouNoCondominio(client, 1)).toBe(true);
    expect(enrolouNoCondominio(client, 2)).toBe(true);
  });
});
