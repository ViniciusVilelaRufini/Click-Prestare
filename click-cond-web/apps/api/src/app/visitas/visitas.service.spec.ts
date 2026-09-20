import { Test, TestingModule } from '@nestjs/testing';
import { VisitasService } from './visitas.service';
import { PessoasService } from '../pessoas/pessoas.service';
import { PrismaService } from '../prisma/prisma.service';

describe('VisitasService', () => {
  let service: VisitasService;
  let pessoasService: PessoasService;

  const mockPrisma = {
    visitas: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    vagas: {
      updateMany: jest.fn(),
    },
  };

  const mockPessoasService = {
    obterOuCriar: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisitasService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PessoasService, useValue: mockPessoasService },
      ],
    }).compile();

    service = module.get<VisitasService>(VisitasService);
    pessoasService = module.get<PessoasService>(PessoasService);
    jest.clearAllMocks();
  });

  it('deve criar uma visita vinculando à pessoa retornada pelo PessoasService', async () => {
    mockPessoasService.obterOuCriar.mockResolvedValue({ id: 50, nome: 'Visitante Teste' });
    mockPrisma.visitas.create.mockResolvedValue({
      id: 100,
      id_pessoa: 50,
      id_condominio: 1,
      id_apartamento: 101,
      codigo_acesso: '1234',
      liberado: 1,
    });

    const visita = await service.criarVisita({
      id_condominio: 1,
      id_apartamento: 101,
      pessoa: { nome: 'Visitante Teste', doc_identificacao: '11122233344' },
      codigo_acesso: '1234',
    });

    expect(mockPessoasService.obterOuCriar).toHaveBeenCalledWith(1, {
      nome: 'Visitante Teste',
      doc_identificacao: '11122233344',
    });
    expect(visita.id).toBe(100);
    expect(visita.id_pessoa).toBe(50);
  });

  it('deve registrar entrada preenchendo data_entrada', async () => {
    mockPrisma.visitas.update.mockResolvedValue({
      id: 100,
      data_entrada: new Date(),
    });

    const res = await service.registrarEntrada(100);
    expect(mockPrisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { data_entrada: expect.any(Date) },
      include: expect.any(Object),
    });
  });

  it('deve registrar saída preenchendo data_saida e liberando vagas associadas', async () => {
    mockPrisma.visitas.update.mockResolvedValue({
      id: 100,
      data_saida: new Date(),
    });

    const res = await service.registrarSaida(100);
    expect(mockPrisma.visitas.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { data_saida: expect.any(Date) },
      include: expect.any(Object),
    });
    expect(mockPrisma.vagas.updateMany).toHaveBeenCalledWith({
      where: { id_visita: 100 },
      data: { ativo: 0 },
    });
  });

  it('deve listar pessoas com presença no local (entrada registrada e sem saída)', async () => {
    mockPrisma.visitas.findMany.mockResolvedValue([
      { id: 100, data_entrada: new Date(), data_saida: null },
    ]);

    const res = await service.listarPresenca(1);
    expect(mockPrisma.visitas.findMany).toHaveBeenCalledWith({
      where: {
        id_condominio: 1,
        data_entrada: { not: null },
        data_saida: null,
      },
      include: expect.any(Object),
      orderBy: { data_entrada: 'desc' },
    });
    expect(res).toHaveLength(1);
  });
});
