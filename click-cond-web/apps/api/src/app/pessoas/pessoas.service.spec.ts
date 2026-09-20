import { Test, TestingModule } from '@nestjs/testing';
import { PessoasService } from './pessoas.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PessoasService', () => {
  let service: PessoasService;
  let prisma: PrismaService;

  const mockPrisma = {
    pessoas: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    visitas: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PessoasService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PessoasService>(PessoasService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('deve normalizar CPF e reaproveitar pessoa existente com mesmo CPF no condomínio', async () => {
    const pessoaExistente = {
      id: 42,
      id_condominio: 1,
      nome: 'Rodrigo Antigo',
      doc_identificacao: '12345678900',
      telefone: null,
      foto_pessoa: 'http://foto.jpg',
      face_id: null,
    };
    mockPrisma.pessoas.findFirst.mockResolvedValue(pessoaExistente);
    mockPrisma.pessoas.update.mockResolvedValue({ ...pessoaExistente, telefone: '11999999999' });

    const resultado = await service.obterOuCriar(1, {
      nome: 'Rodrigo Atualizado',
      doc_identificacao: '123.456.789-00',
      telefone: '11999999999',
    });

    expect(mockPrisma.pessoas.findFirst).toHaveBeenCalledWith({
      where: {
        id_condominio: 1,
        doc_identificacao: '12345678900',
      },
    });
    expect(resultado.id).toBe(42);
    expect(mockPrisma.pessoas.update).toHaveBeenCalled();
  });

  it('deve criar nova Pessoa quando CPF não existir', async () => {
    mockPrisma.pessoas.findFirst.mockResolvedValue(null);
    mockPrisma.pessoas.create.mockResolvedValue({
      id: 99,
      id_condominio: 1,
      nome: 'Novo Visitante',
      doc_identificacao: '98765432100',
    });

    const resultado = await service.obterOuCriar(1, {
      nome: 'Novo Visitante',
      doc_identificacao: '987.654.321-00',
    });

    expect(resultado.id).toBe(99);
    expect(mockPrisma.pessoas.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_condominio: 1,
        nome: 'Novo Visitante',
        doc_identificacao: '98765432100',
      }),
    });
  });

  it('deve listar histórico de visitas de uma pessoa', async () => {
    mockPrisma.visitas.findMany.mockResolvedValue([
      { id: 10, id_pessoa: 42, data_entrada: new Date('2026-09-01') },
      { id: 11, id_pessoa: 42, data_entrada: new Date('2026-09-10') },
    ]);

    const historico = await service.obterHistorico(42);
    expect(historico).toHaveLength(2);
    expect(mockPrisma.visitas.findMany).toHaveBeenCalledWith({
      where: { id_pessoa: 42 },
      include: expect.any(Object),
      orderBy: { created_at: 'desc' },
    });
  });
});
