import { VisitantesService } from './visitantes.service';

describe('VisitantesService.findAllMobile — PIN do morador', () => {
  let service: VisitantesService;
  let vinculos: Array<{ id_apto: number }>;

  const prisma: any = {
    visitantes: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 70,
          id_condominio: 1,
          id_apartamento: 10,
          nome: 'Visitante autorizado',
          codigo_acesso: '123456',
          data_saida: null,
          apartamento: { bloco: 'A', apto: '10' },
          condominio: { nome: 'Condomínio Solar' },
        },
      ]),
    },
    apartamentos_Users: {
      findMany: jest.fn(() => Promise.resolve(vinculos)),
    },
    isConnected: true,
  };

  const noop: any = {
    registrar: jest.fn(),
    emit: jest.fn(),
    syncVisitante: jest.fn(),
    unsyncVisitante: jest.fn(),
    syncPessoa: jest.fn(),
    isDataUrl: () => false,
    uploadDataUrl: jest.fn(),
    assertEntidade: jest.fn(),
  };

  beforeEach(() => {
    process.env['PESSOAS_MIGRATION_ENABLED'] = 'false';
    vinculos = [{ id_apto: 10 }];
    jest.clearAllMocks();
    service = new VisitantesService(prisma, noop, noop, noop, noop, noop, noop, undefined as any);
  });

  it('retorna o PIN ao morador vinculado ao apartamento da visita', async () => {
    const result = await service.findAllMobile(1, 10, '', 0, 7, 'Morador');

    expect(result[0].codigo_acesso).toBe('123456');
  });

  it('não retorna o PIN a morador sem vínculo com o apartamento', async () => {
    vinculos = [{ id_apto: 102 }];

    const result = await service.findAllMobile(1, undefined, '', 0, 8, 'Morador');

    expect(result[0].codigo_acesso).toBeNull();
  });

  it.each(['Porteiro', 'Sindico', 'Funcionario', undefined])(
    'não retorna o PIN para %s mesmo com vínculo no apartamento',
    async (tipo) => {
      const result = await service.findAllMobile(1, 10, '', 0, 7, tipo);

      expect(result[0].codigo_acesso).toBeNull();
    },
  );

  it('não retorna o PIN de uma visita encerrada ao morador vinculado', async () => {
    prisma.visitantes.findMany.mockResolvedValueOnce([
      {
        id: 70,
        id_condominio: 1,
        id_apartamento: 10,
        nome: 'Visitante encerrado',
        codigo_acesso: '123456',
        data_saida: new Date('2026-09-22T15:00:00Z'),
        apartamento: { bloco: 'A', apto: '10' },
        condominio: { nome: 'Condomínio Solar' },
      },
    ]);

    const result = await service.findAllMobile(1, 10, '', 0, 7, 'Morador');

    expect(result[0].codigo_acesso).toBeNull();
  });
});
