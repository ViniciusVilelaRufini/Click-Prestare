import { VisitantesService } from './visitantes.service';

/**
 * Item 1 do fase0: `pessoas`/`visitas` estão no schema do Prisma mas NÃO
 * existem no banco de produção — só a escrita foi migrada, a leitura não.
 * `listarPessoas` tem que continuar servindo o caminho legado (Visitantes)
 * por padrão, e SÓ trocar de fonte com PESSOAS_MIGRATION_ENABLED='true'
 * explícito.
 *
 * A asserção que importa aqui não é "o retorno bate com Visitantes" (isso um
 * bug no branch novo que por acaso devolve o formato certo passaria) — é que
 * `prisma.pessoas.findMany` NUNCA é chamado com a flag desligada. Só assim
 * fica provado que o branch novo nem foi tocado, e não só que "coincidiu" de
 * dar a resposta certa.
 */
describe('VisitantesService.listarPessoas — flag PESSOAS_MIGRATION_ENABLED', () => {
  let service: VisitantesService;

  const mockPrisma: any = {
    pessoas: { findMany: jest.fn() },
    visitas: { findMany: jest.fn() },
    visitantes: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 501,
          id_condominio: 1,
          nome: 'Visitante Legado',
          doc_identificacao: '99988877766',
          foto_pessoa: null,
          foto_documento: null,
          face_id: null,
          is_visitante: 1,
          is_prestador: 0,
          liberado: 0,
          bloqueado: 0,
          tag_rfid: null,
          codigo_acesso: null,
          data_entrada: null,
          data_saida: null,
          data_hora_inicio: new Date('2026-09-19T10:00:00Z'),
          data_hora_termino: null,
          id_apartamento: 101,
          apartamento: { id: 101, bloco: 'A', apto: '101' },
          created_at: new Date('2026-09-19T09:00:00Z'),
          dias_semana: null,
          categorias: null,
        },
      ]),
    },
    vagas: { findMany: jest.fn().mockResolvedValue([]) },
    isConnected: true,
  };

  const noop: any = {
    registrar: jest.fn(),
    sendPush: jest.fn(),
    sendPushNotification: jest.fn(),
    sendWhatsApp: jest.fn(),
    emit: jest.fn(),
  };

  const mockFacial: any = {
    syncVisitante: jest.fn().mockResolvedValue({}),
    unsyncVisitante: jest.fn().mockResolvedValue(true),
    syncPessoa: jest.fn().mockResolvedValue({}),
  };

  const mockStorage: any = {
    isDataUrl: () => false,
    uploadDataUrl: jest.fn(),
  };

  const mockTenant: any = {
    assertEntidade: jest.fn().mockResolvedValue(true),
  };

  const originalFlag = process.env['PESSOAS_MIGRATION_ENABLED'];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  beforeEach(() => {
    service = new VisitantesService(
      mockPrisma,
      noop,
      mockStorage,
      mockFacial,
      noop,
      mockTenant,
      noop,
    );
    jest.clearAllMocks();
  });

  it('com a flag ausente (default), usa o caminho Visitantes e NUNCA chama prisma.pessoas.findMany', async () => {
    delete process.env['PESSOAS_MIGRATION_ENABLED'];

    const res = await service.listarPessoas(1);

    expect(mockPrisma.pessoas.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.visitantes.findMany).toHaveBeenCalled();
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      id: 501,
      nome: 'Visitante Legado',
      doc_identificacao: '99988877766',
    });
  });

  it("com a flag explicitamente 'false', usa o caminho Visitantes e NUNCA chama prisma.pessoas.findMany", async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';

    const res = await service.listarPessoas(1);

    expect(mockPrisma.pessoas.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.visitantes.findMany).toHaveBeenCalled();
    expect(res).toHaveLength(1);
  });

  it("com PESSOAS_MIGRATION_ENABLED='true', usa o caminho Pessoas/Visitas mesmo sem resultados (não cai pro legado por 'faltar dado')", async () => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
    mockPrisma.pessoas.findMany.mockResolvedValueOnce([]);

    const res = await service.listarPessoas(1);

    expect(mockPrisma.pessoas.findMany).toHaveBeenCalled();
    expect(mockPrisma.visitantes.findMany).not.toHaveBeenCalled();
    expect(res).toEqual([]);
  });
});
