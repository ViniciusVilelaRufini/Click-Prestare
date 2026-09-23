import { VisitantesService } from './visitantes.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { VisitasService } from '../visitas/visitas.service';

describe('VisitantesAdapter (Compatibilidade v75)', () => {
  let service: VisitantesService;

  const mockPrisma: any = {
    pessoas: { findMany: jest.fn() },
    visitas: { findMany: jest.fn() },
    visitantes: { findMany: jest.fn().mockResolvedValue([]) },
    vagas: { findMany: jest.fn().mockResolvedValue([]) },
    apartamentos_Users: { findMany: jest.fn().mockResolvedValue([{ id_apto: 101 }]) },
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

  beforeEach(() => {
    // Este describe testa explicitamente o caminho NOVO (Pessoas/Visitas) —
    // por isso liga a flag aqui. Por padrão ela é OFF (ver
    // visitantes.service.pessoas-flag.spec.ts para o comportamento default).
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'true';
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

  afterAll(() => {
    if (originalFlag === undefined) delete process.env['PESSOAS_MIGRATION_ENABLED'];
    else process.env['PESSOAS_MIGRATION_ENABLED'] = originalFlag;
  });

  it('listarPessoas deve consultar Pessoas e Visitas estruturadas sem depender do loop de agrupamento frágil', async () => {
    mockPrisma.pessoas.findMany.mockResolvedValue([
      {
        id: 33,
        id_condominio: 1,
        nome: 'Carlos Visitante',
        doc_identificacao: '12345678900',
        telefone: '11999999999',
        foto_pessoa: 'http://foto.jpg',
        face_id: 'face_123',
        visitas: [
          {
            id: 77,
            id_pessoa: 33,
            id_condominio: 1,
            id_apartamento: 101,
            data_hora_inicio: new Date('2026-09-19T10:00:00Z'),
            data_hora_termino: new Date('2026-09-19T18:00:00Z'),
    codigo_acesso: '4321',
            liberado: 1,
            data_entrada: null,
            data_saida: null,
            apartamento: { id: 101, bloco: 'A', apto: '101' },
          },
        ],
      },
    ]);

    const res = await service.listarPessoas(1);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      id: 77,
      nome: 'Carlos Visitante',
      doc_identificacao: '12345678900',
      foto_pessoa: 'http://foto.jpg',
      codigo_acesso: null,
      liberado: 1,
      totalVisitas: 1,
    });
  });
});
