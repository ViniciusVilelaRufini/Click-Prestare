import { VisitantesService } from './visitantes.service';

/**
 * Task 3 (migração Pessoas/Visitas): `create()` passa a rotear para
 * `PessoasService.obterOuCriar` / `VisitasService.criarVisita` quando
 * `PESSOAS_MIGRATION_ENABLED='true'`. Com a flag desligada (default e
 * 'false' explícito) o caminho tem que continuar 100% em `Visitantes` — e a
 * asserção que prova isso não é "o retorno bate", é que `prisma.pessoas` e
 * `prisma.visitas` (e `VisitasService.criarVisita`) NUNCA são tocados.
 */
describe('VisitantesService.create — flag PESSOAS_MIGRATION_ENABLED', () => {
  let service: VisitantesService;

  const mockPrisma: any = {
    isConnected: true,
    visitantes: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pessoas: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    visitas: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    users: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

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
  const realtime: any = { emitToCondominio: jest.fn() };
  const visitasService: any = { criarVisita: jest.fn() };

  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.visitantes.findFirst.mockResolvedValue(null);
    mockPrisma.visitantes.findUnique.mockResolvedValue(null);
    mockPrisma.visitantes.findMany.mockResolvedValue([]);
    mockPrisma.users.findMany.mockResolvedValue([]);
    mockPrisma.visitantes.create.mockResolvedValue({
      id: 501,
      nome: 'Ana',
      doc_identificacao: '11122233344',
      id_apartamento: 101,
      id_condominio: 1,
      foto_pessoa: 'http://foto.jpg',
      foto_documento: null,
      codigo_acesso: '123456',
      face_id: null,
      liberado: 1,
      dias_semana: null,
      categorias: null,
      user: null,
      is_visitante: 1,
      is_prestador: 0,
    });

    service = new VisitantesService(
      mockPrisma,
      notifications,
      storage,
      facial,
      auditoria,
      tenant,
      realtime,
      visitasService,
    );
  });

  const dto = {
    nome: 'Ana',
    doc_identificacao: '11122233344',
    id_apartamento: 101,
    id_condominio: 1,
    foto_pessoa: 'http://foto.jpg',
  };

  it('com a flag ausente (default), create() escreve em Visitantes e NUNCA toca prisma.pessoas/prisma.visitas/VisitasService', async () => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];

    const res = await service.create({ ...dto } as any);

    expect(mockPrisma.visitantes.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pessoas.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.pessoas.create).not.toHaveBeenCalled();
    expect(mockPrisma.visitas.create).not.toHaveBeenCalled();
    expect(visitasService.criarVisita).not.toHaveBeenCalled();
    expect(res.id).toBe(501);
  });

  it("com a flag explicitamente 'false', o mesmo vale", async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';

    await service.create({ ...dto } as any);

    expect(mockPrisma.visitantes.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.pessoas.create).not.toHaveBeenCalled();
    expect(mockPrisma.visitas.create).not.toHaveBeenCalled();
    expect(visitasService.criarVisita).not.toHaveBeenCalled();
  });

  it("com PESSOAS_MIGRATION_ENABLED='true', create() para de escrever em Visitantes e delega a VisitasService.criarVisita", async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    visitasService.criarVisita.mockResolvedValue({
      id: 900,
      id_pessoa: 5,
      id_condominio: 1,
      id_apartamento: 101,
      user: null,
      is_visitante: 1,
      is_prestador: 0,
      data_hora_inicio: new Date(),
      data_hora_termino: null,
      data_entrada: null,
      data_saida: null,
      codigo_acesso: '654321',
      liberado: 1,
      bloqueado: 0,
      avisar: 1,
      tag_rfid: null,
      dias_semana: null,
      categorias: null,
      auth_status: null,
      auth_solicitado_em: null,
      auth_respondido_em: null,
      auth_respondido_por: null,
      created_at: new Date(),
      updated_at: new Date(),
      pessoa: {
        id: 5,
        nome: 'Ana',
        doc_identificacao: '11122233344',
        foto_pessoa: 'http://foto.jpg',
        foto_documento: null,
        face_id: null,
        face_enrolled_at: null,
        face_sync_status: null,
        face_sync_error: null,
      },
      apartamento: { id: 101, bloco: 'A', apto: '101' },
    });

    const res = await service.create({ ...dto } as any);

    expect(mockPrisma.visitantes.create).not.toHaveBeenCalled();
    expect(visitasService.criarVisita).toHaveBeenCalledTimes(1);
    expect(res.id).toBe(900);
    expect(res.nome).toBe('Ana');
  });
});
