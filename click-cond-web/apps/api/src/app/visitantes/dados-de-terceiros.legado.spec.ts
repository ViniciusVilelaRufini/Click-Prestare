import { VisitantesService } from './visitantes.service';

const SENSIVEIS = ['foto_documento', 'face_id', 'face_sync_status', 'face_enrolled_at', 'face_sync_error'];

/**
 * Caminho legado (Visitantes), o que está em produção. As buscas por CPF/nome
 * eram do condomínio inteiro: o morador herdava foto, documento e face_id do
 * visitante do vizinho, reaproveitava (e sequestrava) a visita ativa dele e
 * reescrevia o cadastro dele via nome_anterior. Depois, a lista e o detalhe
 * devolviam a linha inteira.
 */
describe('Visitantes legado — morador não alcança cadastros de outros apartamentos', () => {
  const original = process.env['PESSOAS_MIGRATION_ENABLED'];
  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
  });
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
    id_apartamento: 100,
    id_condominio: 1,
  };

  function casa(row: any, where: any): boolean {
    if (where.id_condominio !== undefined && row.id_condominio !== where.id_condominio) return false;
    if (where.id_apartamento?.in && !where.id_apartamento.in.includes(row.id_apartamento)) return false;
    if (where.doc_identificacao !== undefined && row.doc_identificacao !== where.doc_identificacao) return false;
    if (where.nome !== undefined && row.nome !== where.nome) return false;
    if (where.codigo_acesso !== undefined && row.codigo_acesso !== where.codigo_acesso) return false;
    if (where.bloqueado !== undefined && row.bloqueado !== where.bloqueado) return false;
    if (where.data_entrada === null && row.data_entrada !== null) return false;
    if (where.data_saida === null && row.data_saida !== null) return false;
    if (where.OR && !where.OR.some((o: any) => casa(row, o))) return false;
    if (where.AND && !where.AND.every((o: any) => casa(row, o))) return false;
    if (where.id !== undefined && typeof where.id === 'number' && row.id !== where.id) return false;
    return true;
  }

  function build() {
    const vizinho: any = {
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
      codigo_acesso: '111111',
      liberado: 1,
      user: 99,
      data_entrada: null,
      data_saida: null,
      is_visitante: 1,
      is_prestador: 0,
      bloqueado: 0,
      created_at: new Date('2026-10-01T00:00:00Z'),
    };
    const rows: any[] = [vizinho];
    let seq = 100;
    const prisma: any = {
      isConnected: true,
      visitantes: {
        findMany: jest.fn(async ({ where }: any) =>
          rows.filter((r) => casa(r, where)).map((r) => ({ ...r, apartamento: { bloco: 'A', apto: String(r.id_apartamento) } })),
        ),
        findFirst: jest.fn(async ({ where }: any) => rows.find((r) => casa(r, where)) ?? null),
        findUnique: jest.fn(async ({ where }: any) => {
          const r = rows.find((x) => x.id === where.id);
          return r ? { ...r, apartamento: { bloco: 'A', apto: String(r.id_apartamento) } } : null;
        }),
        update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: any) => {
          const nova = { id: seq++, data_entrada: null, data_saida: null, bloqueado: 0, created_at: new Date(), ...data };
          rows.push(nova);
          return nova;
        }),
      },
      apartamentos: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, id_condominio: 1 })) },
      apartamentos_Users: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_user === 2 && where.id_apto === 100 ? { id_apto: 100 } : null,
        ),
        findMany: jest.fn(async ({ where }: any) => (where.id_user === 2 ? [{ id_apto: 100 }] : [])),
      },
      users: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => ({ id: 2, name: 'Morador A' })) },
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
    return { service, prisma, rows, vizinho };
  }

  it('criar com o CPF do visitante do vizinho não herda foto, documento nem face_id para a linha do morador', async () => {
    const { service, rows } = build();
    const r: any = await service.create({ ...novaVisita } as any, moradorA);
    for (const k of SENSIVEIS) expect(r).not.toHaveProperty(k);
    expect(r.foto_pessoa ?? null).toBeNull();
    const gravada = rows.find((x) => x.id_apartamento === 100);
    expect(gravada.foto_pessoa ?? null).toBeNull();
    expect(gravada.foto_documento ?? null).toBeNull();
    expect(gravada.face_id ?? null).toBeNull();
  });

  it('depois de criar, lista e detalhe do morador não trazem o rosto/documento do vizinho', async () => {
    const { service } = build();
    const criada: any = await service.create({ ...novaVisita } as any, moradorA);
    const lista: any[] = await service.findAllMobile(1, undefined, undefined, 0, 2, 'Morador');
    expect(lista.length).toBe(1);
    for (const k of SENSIVEIS) expect(lista[0]).not.toHaveProperty(k);
    expect(lista[0].foto_pessoa ?? null).toBeNull();
    const um: any = await service.findOne(criada.id, moradorA);
    for (const k of SENSIVEIS) expect(um).not.toHaveProperty(k);
    expect(um.foto_pessoa ?? null).toBeNull();
  });

  it('a lista e o detalhe do morador recortam também a linha do próprio apartamento', async () => {
    const { service, rows } = build();
    const propria = { ...rows[0], id: 6, id_apartamento: 100 };
    rows.push(propria);
    const lista: any[] = await service.findAllMobile(1, undefined, undefined, 0, 2, 'Morador');
    for (const k of SENSIVEIS) expect(lista[0]).not.toHaveProperty(k);
    const um: any = await service.findOne(6, moradorA);
    for (const k of SENSIVEIS) expect(um).not.toHaveProperty(k);
  });

  it('update legado devolve a linha sem foto_documento/face_* ao morador', async () => {
    const { service, rows } = build();
    rows.push({ ...rows[0], id: 6, id_apartamento: 100, doc_identificacao: null });
    const r: any = await service.update({ id: 6, nome: 'Novo' } as any, moradorA);
    for (const k of SENSIVEIS) expect(r).not.toHaveProperty(k);
  });

  it('não sequestra a visita ativa do vizinho: cria linha nova no apartamento do morador', async () => {
    const { service, prisma, rows, vizinho } = build();
    await service.create({ ...novaVisita } as any, moradorA);
    expect(prisma.visitantes.update).not.toHaveBeenCalled();
    expect(prisma.visitantes.create).toHaveBeenCalled();
    expect(vizinho.id_apartamento).toBe(200);
    expect(vizinho.user).toBe(99);
    expect(vizinho.codigo_acesso).toBe('111111');
    expect(rows).toHaveLength(2);
  });

  it('visita ativa do PRÓPRIO apartamento continua sendo reaproveitada', async () => {
    const { service, prisma, rows } = build();
    rows.push({ ...rows[0], id: 6, id_apartamento: 100 });
    await service.create({ ...novaVisita } as any, moradorA);
    expect(prisma.visitantes.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 6 } }));
  });

  it('operador continua reaproveitando a visita ativa e vendo foto do documento e face_id', async () => {
    const { service, prisma } = build();
    const r: any = await service.create({ ...novaVisita } as any, porteiro);
    expect(prisma.visitantes.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
    expect(r.foto_documento).toBe('DOC-REAL');
    expect(r.face_id).toBe('face-7');
  });

  it('nome_anterior: a correção em massa do morador fica restrita aos apartamentos dele', async () => {
    const { service, prisma } = build();
    await service.create({ ...novaVisita, nome_anterior: 'Real', id_anterior: 5 } as any, moradorA);
    const chamada = prisma.visitantes.updateMany.mock.calls[0][0];
    expect(chamada.where.id_apartamento).toEqual({ in: [100] });
  });

  it('nome_anterior: operador segue corrigindo o condomínio inteiro', async () => {
    const { service, prisma } = build();
    await service.create({ ...novaVisita, nome_anterior: 'Real', id_anterior: 5 } as any, porteiro);
    const chamada = prisma.visitantes.updateMany.mock.calls[0][0];
    expect(chamada.where.id_apartamento).toBeUndefined();
  });
});
