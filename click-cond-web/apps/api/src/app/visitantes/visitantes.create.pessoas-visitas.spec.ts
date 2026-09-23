import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

/**
 * Task 3 (migração Pessoas/Visitas): com PESSOAS_MIGRATION_ENABLED='true',
 * `create()` roteia identidade por `PessoasService.obterOuCriar` (via
 * `VisitasService.criarVisita`) e autorização por `Visitas` — nunca mais
 * `prisma.visitantes`. Usa instâncias REAIS de `PessoasService`/
 * `VisitasService` (mesmo padrão de `pessoas.identidade.spec.ts`) sobre um
 * prisma em memória, para provar a fusão de identidade de ponta a ponta —
 * não só que os métodos certos foram chamados.
 */
describe('VisitantesService.create — caminho novo (Pessoas/Visitas)', () => {
  function build() {
    let pessoasSeq = 1;
    let visitasSeq = 1;
    const pessoas: any[] = [];
    const visitas: any[] = [];

    const prisma: any = {
      isConnected: true,
      visitantes: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      pessoas: {
        findFirst: jest.fn(async ({ where }: any) => {
          if (where.bloqueado === 1) return null; // ninguém bloqueado nestes testes
          return (
            pessoas.find((p) => {
              if (p.id_condominio !== where.id_condominio) return false;
              if (where.doc_identificacao) return p.doc_identificacao === where.doc_identificacao;
              if (where.face_id) return p.face_id === where.face_id;
              return false;
            }) ?? null
          );
        }),
        create: jest.fn(async ({ data }: any) => {
          const novo = { id: pessoasSeq++, ...data };
          pessoas.push(novo);
          return novo;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const p = pessoas.find((x) => x.id === where.id);
          Object.assign(p, data);
          return p;
        }),
      },
      visitas: {
        create: jest.fn(async ({ data }: any) => {
          const nova = {
            id: visitasSeq++,
            // Campos com default no schema (bloqueado=0) que o `data` de
            // criarVisita não define explicitamente — o Prisma real preenche
            // via DEFAULT da coluna; o mock precisa emular isso.
            bloqueado: 0,
            ...data,
            created_at: new Date('2026-09-20T12:00:00Z'),
            updated_at: new Date('2026-09-20T12:00:00Z'),
          };
          visitas.push(nova);
          const pessoa = pessoas.find((p) => p.id === nova.id_pessoa);
          return { ...nova, pessoa, apartamento: { id: nova.id_apartamento, bloco: 'A', apto: '101' } };
        }),
        // Checagem de unicidade do PIN (gerarPinUnicoVisita) — nunca colide nestes testes.
        findFirst: jest.fn().mockResolvedValue(null),
        // Task 4: `desativarOutrosCodigosVisita`, chamado após cada
        // `criarVisita` — não precisa mudar nada nestes testes, só existir.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      apartamentos: {
        findUnique: jest.fn().mockResolvedValue({ id: 101, id_condominio: 1 }),
      },
      users: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const pessoasService = new PessoasService(prisma);
    const visitasService = new VisitasService(prisma, pessoasService);

    const auditoria: any = { registrar: jest.fn() };
    const notifications: any = { sendPushNotification: jest.fn(), sendWhatsApp: jest.fn() };
    const storage: any = { isDataUrl: () => false, uploadDataUrl: jest.fn() };
    const facial: any = {
      syncVisitante: jest.fn().mockResolvedValue({}),
      syncPessoa: jest.fn().mockResolvedValue({}),
    };
    const tenant: any = {
      assertCondominio: jest.fn().mockResolvedValue(true),
      assertPermissaoFuncionario: jest.fn().mockResolvedValue(true),
    };
    const realtime: any = {};

    const service = new VisitantesService(
      prisma,
      notifications,
      storage,
      facial,
      auditoria,
      tenant,
      realtime,
      visitasService,
    );

    return { service, prisma, pessoas, visitas, facial, auditoria };
  }

  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
  });

  afterAll(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  it('cria uma Pessoa e uma Visita, nunca escreve em Visitantes, e devolve o mesmo formato do caminho legado', async () => {
    const { service, prisma, pessoas, visitas, facial } = build();

    const res = await service.create({
      nome: 'Rodrigo Silva',
      doc_identificacao: '111.222.333-44',
      id_apartamento: 101,
      id_condominio: 1,
      data_hora_inicio: '2026-09-19T10:00:00Z',
      data_hora_termino: '2026-09-19T18:00:00Z',
      foto_pessoa: 'http://foto.jpg',
    } as any);

    expect(prisma.visitantes.create).not.toHaveBeenCalled();
    expect(pessoas).toHaveLength(1);
    expect(visitas).toHaveLength(1);
    expect(visitas[0].id_pessoa).toBe(pessoas[0].id);

    // Mesma "forma achatada" que prisma.visitantes.create() sempre devolveu:
    // mesmos nomes de campo, mesmos tipos — o contrato que o app v75 consome.
    expect(res).toMatchObject({
      id: visitas[0].id,
      nome: 'Rodrigo Silva',
      doc_identificacao: '11122233344',
      id_apartamento: 101,
      id_condominio: 1,
      data_hora_inicio: new Date('2026-09-19T10:00:00Z'),
      data_hora_termino: new Date('2026-09-19T18:00:00Z'),
      is_visitante: 1,
      is_prestador: 0,
      foto_pessoa: 'http://foto.jpg',
      foto_documento: null,
      liberado: 1,
      bloqueado: 0,
      face_id: null,
      dias_semana: null,
      categorias: null,
    });
    expect(typeof res.codigo_acesso).toBe('string');
    expect(res.codigo_acesso).toHaveLength(6);
    expect(res.created_at).toBeInstanceOf(Date);
    expect(res.updated_at).toBeInstanceOf(Date);

    // Sync facial roteado por PESSOA, não mais por "visitante".
    expect(facial.syncPessoa).toHaveBeenCalledWith(pessoas[0].id);
    expect(facial.syncVisitante).not.toHaveBeenCalled();
  });

  it('registrar a mesma pessoa (mesmo documento) duas vezes reaproveita a Pessoa e cria uma segunda Visita — uma pessoa, duas autorizações', async () => {
    const { service, pessoas, visitas } = build();

    const dto = {
      nome: 'Rodrigo Silva',
      doc_identificacao: '11122233344',
      id_apartamento: 101,
      id_condominio: 1,
      data_hora_inicio: '2026-09-19T10:00:00Z',
      data_hora_termino: '2026-09-19T18:00:00Z',
    };

    const r1: any = await service.create({ ...dto } as any);
    const r2: any = await service.create({ ...dto } as any);

    expect(pessoas).toHaveLength(1); // "Rodrigo em 101" e "Rodrigo em 202" (mesmo apto aqui) = 1 humano
    expect(visitas).toHaveLength(2); // ... mas 2 autorizações, nunca reescritas uma sobre a outra
    expect(r1.id).not.toBe(r2.id);
    expect(r1.doc_identificacao).toBe('11122233344');
    expect(r2.doc_identificacao).toBe('11122233344');
  });
});
