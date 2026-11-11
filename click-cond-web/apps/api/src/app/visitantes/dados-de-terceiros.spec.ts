import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';
import { PrestadoresService } from '../prestadores/prestadores.service';

const SENSIVEIS = ['foto_documento', 'face_id', 'face_sync_status', 'face_enrolled_at', 'face_sync_error'];

/**
 * Digitar o CPF de um visitante do vizinho devolvia, na resposta da criação, o
 * nome real, a foto do rosto, a foto do documento e o face_id dele. A resposta
 * destinada a morador só carrega o que o próprio morador digitou; a portaria
 * continua vendo tudo.
 */
describe('Visita criada por morador não revela identidade de terceiros', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  afterEach(() => {
    if (original === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = original;
  });

  const DOC = '52998224725';
  const moradorA = { sub: 2, nome: 'Morador A', typeAccess: 'Morador' } as any;
  const porteiro = { sub: 3, nome: 'Porteiro', id_condominio: 1 } as any;
  const novaVisita = {
    nome: 'Digitado',
    doc_identificacao: DOC,
    foto_pessoa: 'F2',
    id_apartamento: 100,
    id_condominio: 1,
  };

  describe('caminho Pessoas/Visitas', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    });

    function build(opts: { aptoDaVisitaExistente: number }) {
      let visitasSeq = 60;
      const pessoas: any[] = [
        {
          id: 7,
          id_condominio: 1,
          nome: 'Real',
          doc_identificacao: DOC,
          foto_pessoa: 'F1',
          foto_documento: 'DOC-REAL',
          face_id: 'face-7',
          face_sync_status: 'synced',
          face_enrolled_at: new Date('2026-10-01T00:00:00Z'),
          face_sync_error: null,
          tipo_pessoa: 'visitante',
        },
      ];
      const visitas: any[] = [
        {
          id: 50,
          id_pessoa: 7,
          id_condominio: 1,
          id_apartamento: opts.aptoDaVisitaExistente,
          liberado: 1,
          codigo_acesso: '111111',
          data_entrada: null,
          data_saida: null,
          bloqueado: 0,
        },
      ];
      const comRelacoes = (v: any) => ({
        ...v,
        pessoa: pessoas.find((p) => p.id === v.id_pessoa),
        apartamento: { id: v.id_apartamento, bloco: 'A', apto: String(v.id_apartamento) },
      });

      const prisma: any = {
        isConnected: true,
        visitantes: { findFirst: jest.fn(async () => null) },
        pessoas: {
          findFirst: jest.fn(async ({ where }: any) => {
            if (where.bloqueado === 1) return null;
            return (
              pessoas.find(
                (p) =>
                  p.id_condominio === where.id_condominio &&
                  !!where.doc_identificacao &&
                  p.doc_identificacao === where.doc_identificacao,
              ) ?? null
            );
          }),
          create: jest.fn(),
          update: jest.fn(async ({ where, data }: any) => {
            const p = pessoas.find((x) => x.id === where.id);
            Object.assign(p, data);
            return p;
          }),
        },
        visitas: {
          findFirst: jest.fn(async () => null),
          findUnique: jest.fn(async ({ where }: any) => {
            const v = visitas.find((x) => x.id === where.id);
            return v ? comRelacoes(v) : null;
          }),
          count: jest.fn(
            async ({ where }: any) =>
              visitas.filter(
                (v) =>
                  v.id_pessoa === where.id_pessoa &&
                  !(where.id_apartamento?.notIn ?? []).includes(v.id_apartamento),
              ).length,
          ),
          create: jest.fn(async ({ data }: any) => {
            const nova = {
              id: visitasSeq++,
              bloqueado: 0,
              data_entrada: null,
              data_saida: null,
              ...data,
              created_at: new Date('2026-10-20T12:00:00Z'),
              updated_at: new Date('2026-10-20T12:00:00Z'),
            };
            visitas.push(nova);
            return comRelacoes(nova);
          }),
          updateMany: jest.fn(async () => ({ count: 0 })),
        },
        apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 2 && where.id_apto === 100 ? { id_apto: 100 } : null,
          ),
          findMany: jest.fn(async ({ where }: any) => (where.id_user === 2 ? [{ id_apto: 100 }] : [])),
        },
        users: { findMany: jest.fn(async () => []) },
      };

      const pessoasService = new PessoasService(prisma);
      const visitasService = new VisitasService(prisma, pessoasService);
      const facial: any = { syncPessoa: jest.fn().mockResolvedValue({}) };
      const tenant: any = {
        assertCondominio: jest.fn(async () => undefined),
        assertPermissaoFuncionario: jest.fn(async () => undefined),
      };
      const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
      const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
      const service = new VisitantesService(
        prisma,
        notifications,
        storage,
        facial,
        { registrar: jest.fn() } as any,
        tenant,
        {} as any,
        visitasService,
      );
      return { service };
    }

    it('morador com CPF de visitante do vizinho recebe o que digitou, sem foto de documento nem face_*', async () => {
      const { service } = build({ aptoDaVisitaExistente: 200 });
      const r: any = await service.create({ ...novaVisita } as any, moradorA);
      expect(r.nome).toBe('Digitado');
      expect(r.doc_identificacao).toBe(DOC);
      expect(r.foto_pessoa).toBe('F2');
      for (const k of SENSIVEIS) expect(r).not.toHaveProperty(k);
    });

    it('morador sem foto enviada não recebe a foto da Pessoa do vizinho', async () => {
      const { service } = build({ aptoDaVisitaExistente: 200 });
      const r: any = await service.create({ ...novaVisita, foto_pessoa: undefined } as any, moradorA);
      expect(r.nome).toBe('Digitado');
      expect(r.foto_pessoa ?? null).toBeNull();
      for (const k of SENSIVEIS) expect(r).not.toHaveProperty(k);
    });

    it('mesmo com Pessoa só do próprio apartamento, morador não recebe foto de documento nem face_*', async () => {
      const { service } = build({ aptoDaVisitaExistente: 100 });
      const r: any = await service.create({ ...novaVisita } as any, moradorA);
      for (const k of SENSIVEIS) expect(r).not.toHaveProperty(k);
    });

    it('operador continua vendo foto do documento e face_id', async () => {
      const { service } = build({ aptoDaVisitaExistente: 200 });
      const r: any = await service.create({ ...novaVisita } as any, porteiro);
      expect(r.foto_documento).toBe('DOC-REAL');
      expect(r.face_id).toBe('face-7');
      expect(r.face_sync_status).toBe('synced');
    });
  });

  describe('caminho legado (Visitantes)', () => {
    beforeEach(() => {
      process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    });

    function buildLegado() {
      const existente: any = {
        id: 5,
        id_condominio: 1,
        id_apartamento: 200,
        nome: 'Real',
        doc_identificacao: DOC,
        foto_pessoa: 'F1',
        foto_documento: 'DOC-REAL',
        face_id: 'face-7',
        face_sync_status: 'synced',
        face_enrolled_at: new Date('2026-10-01T00:00:00Z'),
        face_sync_error: null,
        data_entrada: null,
        data_saida: null,
        is_visitante: 1,
        is_prestador: 0,
      };
      const prisma: any = {
        isConnected: true,
        visitantes: {
          findMany: jest.fn(async () => [existente]),
          findFirst: jest.fn(async ({ where }: any) => (where.doc_identificacao === DOC ? existente : null)),
          update: jest.fn(async ({ data }: any) => Object.assign(existente, data)),
          updateMany: jest.fn(async () => ({ count: 0 })),
          create: jest.fn(),
        },
        apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
        apartamentos_Users: {
          findFirst: jest.fn(async ({ where }: any) =>
            where.id_user === 2 && where.id_apto === 100 ? { id_apto: 100 } : null,
          ),
          findMany: jest.fn(async ({ where }: any) => (where.id_user === 2 ? [{ id_apto: 100 }] : [])),
        },
        users: { findMany: jest.fn(async () => []) },
      };
      const tenant: any = {
        assertCondominio: jest.fn(async () => undefined),
        assertPermissaoFuncionario: jest.fn(async () => undefined),
      };
      const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
      const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
      const facial: any = { syncVisitante: jest.fn().mockResolvedValue({}) };
      const service = new VisitantesService(
        prisma,
        notifications,
        storage,
        facial,
        { registrar: jest.fn() } as any,
        tenant,
        {} as any,
        undefined as any,
      );
      return { service };
    }

    it('morador com CPF de visitante do vizinho recebe o que digitou, sem foto de documento nem face_*', async () => {
      const { service } = buildLegado();
      const r: any = await service.create({ ...novaVisita } as any, moradorA);
      expect(r.nome).toBe('Digitado');
      expect(r.foto_pessoa).toBe('F2');
      for (const k of SENSIVEIS) expect(r).not.toHaveProperty(k);
    });

    it('morador sem foto enviada não recebe a foto herdada do cadastro do vizinho', async () => {
      const { service } = buildLegado();
      const r: any = await service.create({ ...novaVisita, foto_pessoa: undefined } as any, moradorA);
      expect(r.foto_pessoa ?? null).toBeNull();
      for (const k of SENSIVEIS) expect(r).not.toHaveProperty(k);
    });

    it('operador continua vendo foto do documento e face_id', async () => {
      const { service } = buildLegado();
      const r: any = await service.create({ ...novaVisita } as any, porteiro);
      expect(r.foto_documento).toBe('DOC-REAL');
      expect(r.face_id).toBe('face-7');
    });
  });
});

describe('PrestadoresService.findAll — morador não recebe documento nem face_*', () => {
  const morador: any = { sub: 50, nome: 'Morador', typeAccess: 'Morador' };
  const porteiro: any = { sub: 52, nome: 'Porteiro', id_condominio: 1 };

  function build() {
    const linha = {
      id: 9,
      nome: 'Eletricista',
      telefone: '1',
      email: null,
      categorias: 'x',
      id_condominio: 1,
      id_apartamento: 7,
      foto_pessoa: 'FP',
      foto_documento: 'FD',
      face_id: 'f-1',
      face_enrolled_at: new Date(),
      face_sync_status: 'synced',
      face_sync_error: null,
      apartamento: { bloco: 'A', apto: '7' },
    };
    const prisma: any = {
      isConnected: true,
      prestadores_servico: { findMany: jest.fn(async () => [{ ...linha }]) },
      apartamentos_Users: { findMany: jest.fn(async () => [{ id_apto: 7 }]) },
      funcionarios_Portaria: { findMany: jest.fn(async () => []) },
    };
    const tenant: any = { assertCondominio: jest.fn(async () => undefined) };
    return new PrestadoresService(prisma, {} as any, {} as any, tenant);
  }

  it('morador: sem foto_documento e sem face_*, mas com a foto da pessoa', async () => {
    const [p]: any[] = await build().findAll(1, undefined, morador);
    for (const k of SENSIVEIS) expect(p).not.toHaveProperty(k);
    expect(p.foto_pessoa).toBe('FP');
    expect(p.nome).toBe('Eletricista');
  });

  it('operador continua vendo tudo', async () => {
    const [p]: any[] = await build().findAll(1, undefined, porteiro);
    expect(p.foto_documento).toBe('FD');
    expect(p.face_id).toBe('f-1');
  });
});
