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
      findUnique: jest.fn().mockResolvedValue({ id: 100, id_condominio: 1 }),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    apartamentos: {
      findUnique: jest.fn().mockResolvedValue({ id: 101, id_condominio: 1 }),
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
      data_hora_inicio: '2026-09-19T10:00:00Z',
      data_hora_termino: '2026-09-19T18:00:00Z',
      codigo_acesso: '1234',
    });

    expect(mockPessoasService.obterOuCriar).toHaveBeenCalledWith(1, {
      nome: 'Visitante Teste',
      doc_identificacao: '11122233344',
    });
    expect(visita.id).toBe(100);
    expect(visita.id_pessoa).toBe(50);
    expect(mockPrisma.apartamentos.findUnique).toHaveBeenCalledWith({
      where: { id: 101 },
      select: { id: true, id_condominio: true },
    });
  });

  it('deve recusar criarVisita quando o apartamento pertence a outro condomínio (IDOR)', async () => {
    mockPrisma.apartamentos.findUnique.mockResolvedValueOnce({ id: 202, id_condominio: 2 });

    await expect(
      service.criarVisita({
        id_condominio: 1,
        id_apartamento: 202,
        pessoa: { nome: 'Visitante Teste' },
      }),
    ).rejects.toThrow('este apartamento pertence a outro condomínio');
    expect(mockPessoasService.obterOuCriar).not.toHaveBeenCalled();
    expect(mockPrisma.visitas.create).not.toHaveBeenCalled();
  });

  it('deve recusar criarVisita com 400 quando o apartamento não existe', async () => {
    mockPrisma.apartamentos.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.criarVisita({
        id_condominio: 1,
        id_apartamento: 999,
        pessoa: { nome: 'Visitante Teste' },
      }),
    ).rejects.toThrow('Apartamento não encontrado');
    expect(mockPrisma.visitas.create).not.toHaveBeenCalled();
  });

  it('deve registrar entrada preenchendo data_entrada', async () => {
    mockPrisma.visitas.update.mockResolvedValue({
      id: 100,
      data_entrada: new Date(),
    });

    const res = await service.registrarEntrada(100, 1);
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

    const res = await service.registrarSaida(100, 1);
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

  it('deve recusar registrarEntrada com 404 quando a visita não existe', async () => {
    mockPrisma.visitas.findUnique.mockResolvedValueOnce(null);

    await expect(service.registrarEntrada(999, 1)).rejects.toThrow('Visita 999 não encontrada');
    expect(mockPrisma.visitas.update).not.toHaveBeenCalled();
  });

  it('deve recusar registrarEntrada com 403 quando a visita pertence a outro condomínio (IDOR)', async () => {
    mockPrisma.visitas.findUnique.mockResolvedValueOnce({ id: 100, id_condominio: 2 });

    await expect(service.registrarEntrada(100, 1)).rejects.toThrow(
      'esta visita pertence a outro condomínio',
    );
    expect(mockPrisma.visitas.update).not.toHaveBeenCalled();
  });

  it('deve recusar registrarSaida com 403 quando a visita pertence a outro condomínio (IDOR)', async () => {
    mockPrisma.visitas.findUnique.mockResolvedValueOnce({ id: 100, id_condominio: 2 });

    await expect(service.registrarSaida(100, 1)).rejects.toThrow(
      'esta visita pertence a outro condomínio',
    );
    expect(mockPrisma.visitas.update).not.toHaveBeenCalled();
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
